import { readFile } from 'node:fs/promises';
import { clip, stripHtml } from '../lib/feeds.mjs';
import { fetchJSON } from '../lib/http.mjs';
import { HOME, milesFrom } from '../lib/geo.mjs';

const dayIndex = () => Math.floor(Date.now() / 864e5);
const todayPT = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

export async function quakes() {
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const [world, local] = await Promise.all([
    fetchJSON('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson'),
    fetchJSON(
      `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${HOME.lat}&longitude=${HOME.lon}&maxradiuskm=250&minmagnitude=2.5&starttime=${since}&orderby=time&limit=40`,
    ),
  ]);
  const toItem = (f, near) => {
    const [lon, lat] = f.geometry.coordinates;
    const mi = milesFrom(lat, lon);
    return {
      title: f.properties.place || 'Unknown location',
      url: f.properties.url,
      source: near ? 'SoCal' : 'World',
      time: new Date(f.properties.time).toISOString(),
      badge: `M${f.properties.mag.toFixed(1)}`,
      meta: near ? `${Math.round(mi)} mi from home` : f.properties.tsunami ? 'tsunami flag' : '',
      mag: f.properties.mag,
    };
  };
  const items = [
    ...local.features.map((f) => toItem(f, true)),
    ...world.features.filter((f) => f.properties.mag >= 5).map((f) => toItem(f, false)),
  ].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  return { items: items.slice(0, 50) };
}

export async function launches() {
  const j = await fetchJSON('https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=20&mode=list');
  const items = j.results.map((l) => ({
    title: l.name,
    url: `https://www.google.com/search?q=${encodeURIComponent(l.name + ' launch')}`,
    source: l.lsp_name || l.launch_service_provider?.name || 'Launch',
    time: l.net,
    badge: l.status?.abbrev || '',
    meta: l.location || l.pad?.location?.name || '',
    upcoming: true,
  }));
  return { items };
}

export async function wikipedia() {
  const [y, m, d] = todayPT().split('-');
  const f = await fetchJSON(`https://en.wikipedia.org/api/rest_v1/feed/featured/${y}/${m}/${d}`);
  const pageUrl = (p) => p?.content_urls?.desktop?.page;
  return {
    items: [],
    featured: f.tfa && {
      title: stripHtml(f.tfa.displaytitle || f.tfa.normalizedtitle),
      url: pageUrl(f.tfa),
      extract: clip(f.tfa.extract, 420),
      thumb: f.tfa.thumbnail?.source || null,
    },
    news: (f.news || []).slice(0, 6).map((n) => ({
      text: stripHtml(n.story),
      url: pageUrl(n.links?.[0]),
    })),
    onthisday: (f.onthisday || [])
      .slice(0, 8)
      .map((o) => ({ year: o.year, text: o.text, url: pageUrl(o.pages?.[0]) })),
  };
}

export async function concept() {
  const list = JSON.parse(await readFile(new URL('../data/concepts.json', import.meta.url), 'utf8'));
  // Show today's plus the next two so the card has something to flip through.
  const picks = [0, 1, 2].map((k) => list[(dayIndex() + k) % list.length]);
  const cards = await Promise.all(
    picks.map(async (c) => {
      const s = await fetchJSON(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(c.wiki)}`,
      ).catch(() => null);
      return {
        term: c.term,
        track: c.track,
        extract: s ? clip(s.extract, 520) : '',
        url: s?.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(c.wiki)}`,
      };
    }),
  );
  return { items: [], cards };
}

export async function attack() {
  const bundle = await fetchJSON(
    'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json',
    { timeout: 120000 },
  );
  const techniques = bundle.objects
    .filter((o) => o.type === 'attack-pattern' && !o.revoked && !o.x_mitre_deprecated)
    .sort((a, b) => a.id.localeCompare(b.id));
  const t = techniques[dayIndex() % techniques.length];
  const ref = t.external_references.find((r) => r.source_name === 'mitre-attack');
  return {
    items: [],
    technique: {
      id: ref?.external_id,
      name: t.name,
      url: ref?.url,
      tactics: (t.kill_chain_phases || []).map((k) => k.phase_name.replace(/-/g, ' ')),
      platforms: t.x_mitre_platforms || [],
      description: clip(t.description.replace(/\(Citation:[^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'), 600),
      detection: clip((t.x_mitre_detection || '').replace(/\(Citation:[^)]*\)/g, ''), 300),
    },
  };
}
