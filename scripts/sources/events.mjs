import Anthropic from '@anthropic-ai/sdk';
import { fetchText } from '../lib/http.mjs';
import { fetchFeed, stripHtml, clip } from '../lib/feeds.mjs';
import { HOME, milesFrom } from '../lib/geo.mjs';

const MAX_PRICE = 20; // "cheap" ceiling in USD
const WINDOW_DAYS = 14;
const MAX_NEW_ARTICLES_PER_RUN = 6; // caps Claude spend per run
const MODEL = process.env.KB_MODEL || 'claude-opus-5-5';

const ptDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
const addDays = (ymd, n) => ptDate(new Date(Date.parse(ymd + 'T12:00:00Z') + n * 864e5));

const ldBlocks = (html) =>
  [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => {
    try {
      return [JSON.parse(m[1])];
    } catch {
      return [];
    }
  });

const TECH_RE = /\b(ai|llm|gpt|claude|founder|startup|hackathon|developer|devs?|engineer|tech|cyber|security|data|ml|web3|crypto|product|vc|demo day|coding|python|agents?)\b/i;

function categorize(title, fallback = 'community') {
  if (TECH_RE.test(title)) return 'tech';
  if (/comedy|stand-?up|improv/i.test(title)) return 'comedy';
  if (/concert|music|jazz|dj|band|live music|symphony/i.test(title)) return 'music';
  if (/film|movie|screening|cinema/i.test(title)) return 'film';
  if (/market|farmers|swap meet|flea/i.test(title)) return 'market';
  if (/hike|run club|running|walk|beach|park|bike|yoga|outdoor/i.test(title)) return 'outdoors';
  if (/art|gallery|exhibit|museum/i.test(title)) return 'arts';
  if (/food|taco|beer|wine|tasting|brunch|coffee|matcha/i.test(title)) return 'food';
  if (/kids|family|storytime|children/i.test(title)) return 'family';
  return fallback;
}

// ---------- Luma (structured, has price + coordinates) ----------
async function luma() {
  const html = await fetchText('https://lu.ma/la');
  const nd = JSON.parse(html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]);
  const data = nd.props.pageProps.initialData.data;
  let entries = data.events || [];
  const placeId = data.place?.api_id;
  if (placeId) {
    try {
      const more = JSON.parse(
        await fetchText(
          `https://api.lu.ma/discover/get-paginated-events?discover_place_api_id=${placeId}&pagination_limit=100`,
        ),
      );
      if (Array.isArray(more.entries) && more.entries.length) entries = more.entries;
    } catch {
      /* page data is enough */
    }
  }
  return entries
    .filter((e) => !e.ticket_info?.is_sold_out)
    .map((e) => {
      const ev = e.event;
      const cents = e.ticket_info?.price?.cents;
      const free = !!e.ticket_info?.is_free;
      const geo = ev.geo_address_info || {};
      return {
        title: ev.name,
        url: `https://lu.ma/${ev.url}`,
        source: 'Luma',
        start: ev.start_at,
        end: ev.end_at,
        allDay: false,
        venue: geo.address || '',
        area: geo.sublocality || geo.city || '',
        lat: ev.coordinate?.latitude ?? null,
        lon: ev.coordinate?.longitude ?? null,
        free,
        priceMax: free ? 0 : cents != null ? cents / 100 : null,
        priceText: free ? 'Free' : cents != null ? `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}` : '',
        approval: !!e.ticket_info?.require_approval,
        image: ev.cover_url || null,
        category: categorize(ev.name),
      };
    });
}

// ---------- Eventbrite free-event listing pages (JSON-LD) ----------
const EB_PAGES = ['ca--carson', 'ca--long-beach', 'ca--torrance', 'ca--los-angeles', 'ca--santa-monica', 'ca--pasadena'];

async function eventbrite() {
  const failures = [];
  const pages = await Promise.all(
    EB_PAGES.map((slug) =>
      fetchText(`https://www.eventbrite.com/d/${slug}/free--events/`).catch((err) => {
        failures.push(`${slug}: ${err.message}`);
        return '';
      }),
    ),
  );
  if (failures.length === EB_PAGES.length) throw new Error(`all pages failed (${failures[0]})`);
  const out = [];
  for (const html of pages) {
    for (const block of ldBlocks(html)) {
      for (const li of block.itemListElement || []) {
        const it = li.item;
        if (!it || it['@type'] !== 'Event') continue;
        const addr = it.location?.address || {};
        const lat = Number(it.location?.geo?.latitude);
        const lon = Number(it.location?.geo?.longitude);
        out.push({
          title: it.name,
          url: it.url,
          source: 'Eventbrite',
          start: it.startDate,
          end: it.endDate,
          allDay: !String(it.startDate).includes('T'),
          venue: it.location?.name || '',
          area: addr.addressLocality || '',
          lat: Number.isFinite(lat) ? lat : null,
          lon: Number.isFinite(lon) ? lon : null,
          free: true,
          priceMax: 0,
          priceText: 'Free',
          category: categorize(it.name),
          summary: clip(it.description || '', 160),
          image: it.image || null,
        });
      }
    }
  }
  return out;
}

// ---------- Meetup (JSON-LD; price not listed, most are free) ----------
async function meetup() {
  const html = await fetchText('https://www.meetup.com/find/?location=us--ca--Los%20Angeles&source=EVENTS');
  const events = ldBlocks(html).flat().filter((x) => x && x['@type'] === 'Event');
  return events
    .filter((e) => !/Online/i.test(e.eventAttendanceMode || ''))
    .map((e) => ({
      title: e.name,
      url: e.url,
      source: 'Meetup',
      start: e.startDate,
      end: e.endDate || null,
      allDay: false,
      venue: e.location?.name || '',
      area: e.location?.address?.addressLocality || '',
      lat: e.location?.geo?.latitude ?? null,
      lon: e.location?.geo?.longitude ?? null,
      free: null,
      priceMax: null,
      priceText: 'Check',
      category: categorize(e.name),
    }));
}

// ---------- Editorial roundups, extracted by Claude ----------
const ARTICLE_FEEDS = [
  ['https://www.welikela.com/feed/', 'We Like L.A.'],
  ['https://secretlosangeles.com/feed/', 'Secret Los Angeles'],
  ['https://www.latimes.com/topic/things-to-do/rss2.0.xml', 'LA Times'],
  ['https://laist.com/index.atom', 'LAist'],
];
const ROUNDUP_RE = /things to do|this weekend|free|events?|festival|happening|guide|where to|best .* in l\.?a/i;

const EVENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['events'],
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title', 'start_date', 'end_date', 'time_text', 'venue', 'city', 'lat', 'lon',
          'is_free', 'price_max_usd', 'price_text', 'category', 'summary', 'url',
        ],
        properties: {
          title: { type: 'string' },
          start_date: { type: 'string', description: 'YYYY-MM-DD in Pacific time' },
          end_date: { type: ['string', 'null'], description: 'YYYY-MM-DD, null for single-day events' },
          time_text: { type: ['string', 'null'], description: 'e.g. "7-10pm", null if not stated' },
          venue: { type: 'string' },
          city: { type: 'string', description: 'Neighborhood or city, e.g. "Echo Park", "Long Beach"' },
          lat: { type: ['number', 'null'], description: 'Approximate venue latitude if you know the venue' },
          lon: { type: ['number', 'null'] },
          is_free: { type: 'boolean' },
          price_max_usd: { type: ['number', 'null'], description: 'Cheapest general ticket in USD, 0 if free, null if unknown' },
          price_text: { type: 'string' },
          category: {
            type: 'string',
            enum: ['music', 'arts', 'film', 'food', 'market', 'outdoors', 'family', 'tech', 'comedy', 'festival', 'community', 'sports', 'other'],
          },
          summary: { type: 'string', description: 'One plain sentence, under 25 words' },
          url: { type: ['string', 'null'], description: 'Event or venue URL if the article links one' },
        },
      },
    },
  },
};

const SYSTEM = `You extract event listings from Los Angeles "things to do" articles for a personal dashboard.
Return only concrete events with a date that a person could attend in person in Los Angeles County or nearby (Orange County, Ventura, Inland Empire).
Keep events that are free or cost at most $${MAX_PRICE}. Drop events that are clearly more expensive, sold out, or already over.
Resolve relative dates ("this Saturday", "through Sunday") against the article's publish date. For ongoing exhibits or runs, set start_date to the opening date and end_date to the closing date.
Do not invent details the article does not state, except approximate lat/lon for well-known venues. If an article lists no qualifying events, return an empty list.`;

let client;
function anthropic() {
  client ??= new Anthropic();
  return client;
}

async function extractArticle(article) {
  let body = article.fullText;
  if (body.length < 1500) {
    try {
      body = stripHtml(await fetchText(article.url));
    } catch {
      /* keep the feed text */
    }
  }
  body = body.slice(0, 40000);

  const supportsFallback = /opus|sonnet|fable/.test(MODEL);
  const params = {
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: EVENT_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: `Article: ${article.title}\nPublisher: ${article.source}\nPublished: ${article.time || 'unknown'}\nURL: ${article.url}\nToday (Pacific): ${ptDate()}\n\n${body}`,
      },
    ],
  };
  if (supportsFallback) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  const res = await anthropic().beta.messages.create(params);
  if (res.stop_reason === 'refusal') throw new Error(`refused (${res.stop_details?.category ?? 'no category'})`);
  if (res.stop_reason === 'max_tokens') throw new Error('output truncated');
  const textBlock = res.content.find((b) => b.type === 'text');
  return JSON.parse(textBlock.text).events;
}

async function editorial(prevArticles, errors) {
  const cutoff = Date.now() - 10 * 864e5;
  const feeds = await Promise.all(
    ARTICLE_FEEDS.map(([url, src]) =>
      fetchFeed(url, src).catch((err) => {
        errors.push(`${src}: ${err.message}`);
        return [];
      }),
    ),
  );
  const candidates = feeds
    .flat()
    .filter((a) => ROUNDUP_RE.test(a.title) && (!a.time || Date.parse(a.time) >= cutoff))
    .map((a) => ({
      ...a,
      fullText: stripHtml(
        a._raw['content:encoded'] || a._raw.content?.['#text'] || a._raw.content || a._raw.description || '',
      ),
    }));

  const articles = {};
  // Keep cached extractions for articles we have already processed.
  for (const [url, a] of Object.entries(prevArticles || {})) {
    if (Date.parse(a.processedAt) > Date.now() - 21 * 864e5) articles[url] = a;
  }

  const fresh = candidates.filter((a) => !articles[a.url]).slice(0, MAX_NEW_ARTICLES_PER_RUN);
  const canCallClaude = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  if (fresh.length && !canCallClaude) errors.push(`Skipped ${fresh.length} articles: ANTHROPIC_API_KEY not set`);

  if (canCallClaude) {
    for (const a of fresh) {
      try {
        const events = await extractArticle(a);
        articles[a.url] = { title: a.title, source: a.source, processedAt: new Date().toISOString(), events };
        console.log(`  claude: ${events.length} events from "${a.title}"`);
      } catch (err) {
        errors.push(`Extract "${a.title}": ${err.message}`);
      }
    }
  }

  const events = Object.entries(articles).flatMap(([articleUrl, a]) =>
    a.events.map((e) => ({
      title: e.title,
      url: e.url || articleUrl,
      source: a.source,
      via: articleUrl,
      start: e.start_date,
      end: e.end_date,
      allDay: true,
      timeText: e.time_text,
      venue: e.venue,
      area: e.city,
      lat: e.lat,
      lon: e.lon,
      approxGeo: true,
      free: e.is_free,
      priceMax: e.is_free ? 0 : e.price_max_usd,
      priceText: e.price_text || (e.is_free ? 'Free' : ''),
      category: e.category,
      summary: e.summary,
    })),
  );
  return { events, articles };
}

// ---------- Places that are free most days (verify hours before going) ----------
const ALWAYS_FREE = [
  { title: 'Getty Center', area: 'Brentwood', url: 'https://www.getty.edu/visit/center/', note: 'Free entry, timed reservation, paid parking', lat: 34.078, lon: -118.474 },
  { title: 'Getty Villa', area: 'Pacific Palisades', url: 'https://www.getty.edu/visit/villa/', note: 'Free, timed ticket required, paid parking', lat: 34.045, lon: -118.565 },
  { title: 'The Broad', area: 'Downtown LA', url: 'https://www.thebroad.org/visit', note: 'Free general admission, reserve ahead', lat: 34.054, lon: -118.25 },
  { title: 'Hammer Museum', area: 'Westwood', url: 'https://hammer.ucla.edu/visit', note: 'Free admission', lat: 34.059, lon: -118.443 },
  { title: 'Griffith Observatory', area: 'Los Feliz', url: 'https://griffithobservatory.org/visit/', note: 'Free building entry, planetarium shows extra', lat: 34.118, lon: -118.3 },
  { title: 'California Science Center', area: 'Exposition Park', url: 'https://californiasciencecenter.org/visit', note: 'Free general admission', lat: 34.016, lon: -118.286 },
  { title: 'California African American Museum', area: 'Exposition Park', url: 'https://caamuseum.org/visit', note: 'Free admission', lat: 34.017, lon: -118.284 },
  { title: 'Dominguez Rancho Adobe Museum', area: 'Rancho Dominguez', url: 'https://dominguezrancho.org/', note: 'Free, limited open days', lat: 33.867, lon: -118.233 },
].map((p) => ({ ...p, miles: Math.round(milesFrom(p.lat, p.lon) * 10) / 10 }));

// ---------- Merge ----------
const normKey = (e) => `${e.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 40)}|${String(e.start).slice(0, 10)}`;

export async function la_events(prev) {
  const errors = [];
  const settle = async (name, fn) => {
    try {
      return await fn();
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
      return [];
    }
  };
  const [lu, eb, mu, ed] = await Promise.all([
    settle('Luma', luma),
    settle('Eventbrite', eventbrite),
    settle('Meetup', meetup),
    editorial(prev?.articles, errors),
  ]);

  const today = ptDate();
  const last = addDays(today, WINDOW_DAYS);
  const seen = new Set();
  const items = [...lu, ...eb, ...mu, ...ed.events]
    .filter((e) => e.title && e.start)
    .filter((e) => e.priceMax == null || e.priceMax <= MAX_PRICE)
    .map((e) => {
      const startDay = e.allDay ? String(e.start).slice(0, 10) : ptDate(new Date(e.start));
      const endDay = e.end ? (e.allDay ? String(e.end).slice(0, 10) : ptDate(new Date(e.end))) : startDay;
      const miles = milesFrom(e.lat, e.lon);
      return { ...e, startDay, endDay, miles: miles == null ? null : Math.round(miles * 10) / 10 };
    })
    .filter((e) => e.endDay >= today && e.startDay <= last)
    .filter((e) => e.miles == null || e.miles <= 60)
    .filter((e) => {
      const k = normKey(e);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.startDay < b.startDay ? -1 : a.startDay > b.startDay ? 1 : (a.miles ?? 99) - (b.miles ?? 99)));

  return { items, places: ALWAYS_FREE, articles: ed.articles, home: HOME, errors };
}
