import { XMLParser } from 'fast-xml-parser';
import { fetchText } from './http.mjs';
import { redditConfigured, redditTop } from './reddit.mjs';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  // Entities are decoded by stripHtml below; the parser's own decoder has an
  // expansion cap that large feeds (Guardian, Google News) exceed.
  processEntities: false,
});

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v) => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  return text(v['#text'] ?? '');
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decodeEntities = (s) =>
  s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

export function stripHtml(html = '') {
  let s = String(html);
  // Atom feeds often carry escaped markup ("&lt;p&gt;"); unescape before stripping tags.
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s);
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  // Some feeds double-encode ("&amp;#39;"), so decode once more when entities remain.
  if (/&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(s)) s = decodeEntities(s);
  return s.replace(/\s+/g, ' ').replace(/ ([.,;:!?)])/g, '$1').trim();
}

export function clip(s, n = 220) {
  s = stripHtml(s);
  return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;
}

function atomLink(entry) {
  const links = asArray(entry.link);
  const alt = links.find((l) => !l['@rel'] || l['@rel'] === 'alternate') || links[0];
  return alt?.['@href'] || text(alt);
}

// Some publishers put a small thumbnail in the feed; ask their image CDN for a larger one.
function upgradeImage(u) {
  if (!u) return null;
  u = stripHtml(u);
  if (!/^https?:\/\//.test(u)) return null;
  return u.replace(/(ichef\.bbci\.co\.uk\/ace\/standard\/)\d+\//, '$1800/');
}

/** The item's picture: RSS media fields first (largest wins), then the first <img> in its HTML. */
function findImage(it) {
  const media = [
    ...asArray(it['media:content']),
    ...asArray(it['media:group']?.['media:content']),
    ...asArray(it['media:thumbnail']),
  ].filter((m) => m?.['@url'] && !/^(video|audio)/.test(m['@type'] || m['@medium'] || ''));
  media.sort((a, b) => (Number(b['@width']) || 0) - (Number(a['@width']) || 0));
  const enclosure = asArray(it.enclosure).find((e) => /^image\//.test(e?.['@type'] || ''));
  const html = [it['content:encoded'], it.description, it.content, it.summary].map(text).join(' ');
  const inline = html.match(/<img[^>]+src=["']([^"']+)["']/i) || html.match(/&lt;img[^&]+src=&quot;([^&]+)&quot;/i);
  return upgradeImage(media[0]?.['@url'] || enclosure?.['@url'] || inline?.[1] || it['itunes:image']?.['@href']);
}

/** Parse RSS 2.0, RDF/RSS 1.0 or Atom into a flat item list. */
export function parseFeed(xml, source) {
  const doc = parser.parse(xml);
  let raw = [];
  if (doc.rss) raw = asArray(doc.rss.channel?.item);
  else if (doc.feed) raw = asArray(doc.feed.entry);
  else if (doc['rdf:RDF']) raw = asArray(doc['rdf:RDF'].item);

  return raw.map((it) => {
    const isAtom = !!doc.feed;
    const link = isAtom ? atomLink(it) : text(it.link) || it.guid?.['#text'] || text(it.guid);
    const date =
      text(it.pubDate) || text(it.published) || text(it.updated) || text(it['dc:date']) || '';
    const summary = text(it.description) || text(it.summary) || text(it['content:encoded']) || text(it.content);
    let title = stripHtml(text(it.title));
    let src = source;
    // Google News appends " - Publisher" to every title.
    const gSource = text(it.source);
    const site = it.source?.['@url'] || null; // Google News gives the publisher's homepage
    if (gSource) {
      src = gSource;
      if (title.endsWith(` - ${gSource}`)) title = title.slice(0, -(gSource.length + 3));
    }
    const t = Date.parse(date);
    return {
      title,
      url: stripHtml(String(link || '')),
      source: src,
      time: Number.isFinite(t) ? new Date(t).toISOString() : null,
      summary: clip(summary),
      image: findImage(it),
      site,
      _raw: it,
    };
  });
}

export async function fetchFeed(url, source, opts) {
  const sub = url.match(/reddit\.com\/r\/([^/]+)\/top\/\.rss\?t=(\w+)/);
  if (sub && redditConfigured()) return redditTop(sub[1], sub[2], source);
  return parseFeed(await fetchText(url, opts), source);
}

/** Fetch many feeds; failures are reported but don't sink the pane. */
export async function gatherFeeds(list, { perFeed = 15 } = {}) {
  const errors = [];
  const results = await Promise.all(
    list.map(async ([url, source, limit]) => {
      try {
        return (await fetchFeed(url, source)).slice(0, limit ?? perFeed);
      } catch (err) {
        errors.push(`${source}: ${err.message}`);
        return [];
      }
    }),
  );
  return { items: results.flat(), errors };
}

const normTitle = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 9).join(' ');

/** Drop duplicate stories (same URL or near-identical headline), newest first. */
export function dedupeSort(items, limit = 40, { maxAgeHours } = {}) {
  const seen = new Set();
  const cutoff = maxAgeHours ? Date.now() - maxAgeHours * 3600e3 : null;
  return items
    .filter((i) => i.title && i.url)
    .filter((i) => !cutoff || !i.time || Date.parse(i.time) >= cutoff)
    .sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0))
    .filter((i) => {
      const k1 = i.url.replace(/[?#].*$/, '');
      const k2 = normTitle(i.title);
      if (seen.has(k1) || seen.has(k2)) return false;
      seen.add(k1);
      seen.add(k2);
      return true;
    })
    .slice(0, limit)
    .map(({ _raw, ...rest }) => rest);
}

/** Round-robin across sources so one chatty feed can't fill the pane. */
export function interleave(items, limit = 40) {
  const bySource = new Map();
  for (const i of items) {
    if (!bySource.has(i.source)) bySource.set(i.source, []);
    bySource.get(i.source).push(i);
  }
  const queues = [...bySource.values()];
  const out = [];
  while (out.length < limit && queues.some((q) => q.length)) {
    for (const q of queues) if (q.length && out.length < limit) out.push(q.shift());
  }
  return out.sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0));
}
