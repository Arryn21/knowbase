// Builds public/data/feeds.json for the dashboard.
// Runs every 15 minutes in GitHub Actions; each pane has its own refresh interval (ttl)
// and reuses the previous run's data when it is still fresh or when its source fails.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as news from './sources/news.mjs';
import * as ai from './sources/ai.mjs';
import * as sec from './sources/security.mjs';
import * as pulse from './sources/pulse.mjs';
import * as know from './sources/knowledge.mjs';
import { la_events } from './sources/events.mjs';
import * as chess from './sources/chess.mjs';
import * as growth from './sources/growth.mjs';
import { fillImages, pruneImageCache } from './lib/og.mjs';

// Panes whose top stories get a preview image fetched when the feed has none.
const FILL_IMAGES = new Set(['india', 'world', 'usa', 'ai_news', 'techniques', 'cyber_news', 'hn', 'community', 'chess_news', 'chess_learn', 'growth_mind', 'growth_body', 'people']);
const FILL_TOP_N = 14;

const OUT_DIR = new URL('../public/data/', import.meta.url);
const SITE_URL = process.env.SITE_URL || 'https://knowbase.vishaltharu.com';
const FORCE = process.argv.includes('--force');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');

// id, group, title, ttl (minutes), builder
const PANES = [
  ['growth_mind', 'growth', 'Mind and character', 60, growth.growth_mind],
  ['growth_body', 'growth', 'Body and personal care', 60, growth.growth_body],
  ['people', 'growth', 'People you follow', 30, growth.people],
  ['books', 'growth', 'Reading list', 1440, growth.books],

  ['india', 'news', 'India', 15, news.india],
  ['world', 'news', 'World', 15, news.world],
  ['usa', 'news', 'USA', 15, news.usa],

  ['ai_news', 'ai', 'AI news', 15, ai.ai_news],
  ['new_models', 'ai', 'New models and pricing', 60, ai.new_models],
  ['hf_trending', 'ai', 'Trending on Hugging Face', 60, ai.hf_trending],
  ['releases', 'ai', 'Tool releases', 60, ai.releases],
  ['research', 'ai', 'Research papers', 120, ai.research],
  ['techniques', 'ai', 'Techniques and methods', 60, ai.techniques],

  ['cyber_news', 'security', 'Cybersecurity news', 15, sec.cyber_news],
  ['vulns', 'security', 'Exploited and critical CVEs', 60, sec.vulns],
  ['ransomware', 'security', 'Ransomware victims', 30, sec.ransomware],
  ['ctf', 'security', 'CTF calendar', 180, sec.ctf],

  ['hn', 'pulse', 'Hacker News', 15, pulse.hn],
  ['github_trending', 'pulse', 'GitHub: new and rising', 60, pulse.github_trending],
  ['community', 'pulse', 'Lobsters and Reddit', 30, pulse.community],

  ['chess_news', 'chess', 'Chess news', 30, chess.chess_news],
  ['chess_live', 'chess', 'Live and upcoming events', 15, chess.chess_live],
  ['chess_learn', 'chess', 'Lessons, tips and tricks', 120, chess.chess_learn],
  ['chess_puzzle', 'chess', 'Daily puzzle', 360, chess.chess_puzzle],

  ['la_events', 'local', 'Free and cheap in LA', 180, la_events],
  ['quakes', 'local', 'Earthquakes', 15, know.quakes],
  ['launches', 'local', 'Space launches', 120, know.launches],

  ['concept', 'knowledge', 'Concept of the day', 720, know.concept],
  ['attack', 'knowledge', 'ATT&CK technique of the day', 720, know.attack],
  ['wikipedia', 'knowledge', 'Wikipedia today', 180, know.wikipedia],
  ['apod', 'knowledge', 'Astronomy picture of the day', 360, know.apod],

  ['status', 'strip', 'Service status', 15, pulse.status],
  ['markets', 'strip', 'Markets', 15, pulse.markets],
];

async function loadPrevious() {
  const tryJSON = async (load) => {
    try {
      return JSON.parse(await load());
    } catch {
      return null;
    }
  };
  const local = await tryJSON(() => readFile(new URL('feeds.json', OUT_DIR), 'utf8'));
  const localCache = await tryJSON(() => readFile(new URL('cache.json', OUT_DIR), 'utf8'));
  if (local) return { feeds: local, cache: localCache || {} };
  // In CI the workspace starts empty, so pull the last deployed copy.
  const remote = await tryJSON(async () => (await fetch(`${SITE_URL}/data/feeds.json`, { signal: AbortSignal.timeout(15000) })).text());
  const remoteCache = await tryJSON(async () => (await fetch(`${SITE_URL}/data/cache.json`, { signal: AbortSignal.timeout(15000) })).text());
  return { feeds: remote || { panes: {} }, cache: remoteCache || {} };
}

const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms).unref()),
  ]);

async function main() {
  const started = Date.now();
  const prev = await loadPrevious();
  const prevPanes = prev.feeds.panes || {};
  const panes = {};
  const cache = { ...prev.cache };
  cache.og ??= {};
  pruneImageCache(cache.og);
  const imageBudget = { left: 90 };

  await Promise.all(
    PANES.map(async ([id, group, title, ttl, build]) => {
      const old = prevPanes[id];
      const age = old?.updatedAt ? (Date.now() - Date.parse(old.updatedAt)) / 60000 : Infinity;
      const skip = ONLY ? !ONLY.includes(id) : !FORCE && age < ttl - 1;
      if (skip && old) {
        panes[id] = old;
        return;
      }
      const t0 = Date.now();
      try {
        const prevForPane = id === 'la_events' ? { articles: cache.articles } : old;
        const { errors = [], articles, ...data } = await withTimeout(build(prevForPane), 240000, id);
        if (articles) cache.articles = articles;
        if (FILL_IMAGES.has(id) && data.items?.length) await fillImages(data.items.slice(0, FILL_TOP_N), cache.og, imageBudget);
        const hasContent = data.items?.length || Object.entries(data).some(([k, v]) => k !== 'items' && v);
        if (!hasContent && old) {
          throw new Error(`no items (${errors.join('; ') || 'empty response'})`);
        }
        panes[id] = { id, group, title, updatedAt: new Date().toISOString(), ...data, errors };
        console.log(`✓ ${id.padEnd(16)} ${String(data.items?.length ?? '-').padStart(3)} items  ${Date.now() - t0}ms${errors.length ? `  (${errors.length} source errors)` : ''}`);
        errors.forEach((e) => console.log(`    ! ${e}`));
      } catch (err) {
        console.log(`✗ ${id.padEnd(16)} ${err.message}${old ? '  (keeping previous data)' : ''}`);
        panes[id] = old
          ? { ...old, stale: true, errors: [err.message] }
          : { id, group, title, updatedAt: null, items: [], errors: [err.message] };
      }
    }),
  );

  const ordered = Object.fromEntries(PANES.map(([id]) => [id, panes[id]]));
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    new URL('feeds.json', OUT_DIR),
    JSON.stringify({ generatedAt: new Date().toISOString(), panes: ordered }),
  );
  await writeFile(new URL('cache.json', OUT_DIR), JSON.stringify(cache));
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
