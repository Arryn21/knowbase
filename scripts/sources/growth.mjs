import { readFile } from 'node:fs/promises';
import { gatherFeeds, dedupeSort, interleave, fetchFeed } from '../lib/feeds.mjs';
import { fetchJSON } from '../lib/http.mjs';
import { gnews } from './news.mjs';

export async function growth_mind() {
  const { items, errors } = await gatherFeeds([
    ['https://jamesclear.com/feed', 'James Clear', 4],
    ['https://fs.blog/feed/', 'Farnam Street', 6],
    ['https://markmanson.net/feed', 'Mark Manson', 4],
    ['https://www.bakadesuyo.com/feed/', 'Barking Up the Wrong Tree', 3],
    ['https://psyche.co/feed', 'Psyche', 8],
    ['https://dailystoic.com/feed/', 'Daily Stoic', 5],
    ['https://ryanholiday.net/feed/', 'Ryan Holiday', 4],
    ['https://www.calnewport.com/feed/', 'Cal Newport', 4],
    ['https://greatergood.berkeley.edu/site/rss/articles', 'Greater Good', 8],
    ['https://www.reddit.com/r/selfimprovement/top/.rss?t=day', 'r/selfimprovement', 4],
  ]);
  items.forEach((i) => i.source.startsWith('r/') && (i.summary = ''));
  return { items: interleave(dedupeSort(items, 120), 40), errors };
}

export async function growth_body() {
  const { items, errors } = await gatherFeeds([
    ['https://www.artofmanliness.com/feed/', 'Art of Manliness', 10],
    ['https://www.nerdfitness.com/feed/', 'Nerd Fitness', 6],
    ['https://peterattiamd.com/feed/', 'Peter Attia', 6],
    ['https://www.menshealth.com/rss/all.xml/', "Men's Health", 12],
    ['https://feeds.megaphone.fm/hubermanlab', 'Huberman Lab', 4],
  ]);
  return { items: interleave(dedupeSort(items, 100), 36), errors };
}

// Real people get news; the two TV characters get news about their actors and shows.
const PEOPLE = [
  ['"Henry Cavill"', 'Henry Cavill'],
  ['"Elon Musk"', 'Elon Musk', 8],
  ['"Bruce Lee"', 'Bruce Lee'],
  ['"Tom Ellis" actor OR "Lucifer Morningstar"', 'Lucifer'],
  ['"Simon Baker" actor OR "The Mentalist" CBS OR "Patrick Jane"', 'The Mentalist'],
  ['"Robert Downey Jr." OR "Iron Man" Marvel', 'Iron Man'],
  ['"Ben Affleck"', 'Ben Affleck'],
];

// Wikipedia page used for each person's photo. The TV characters use their actors.
const FACES = {
  'Henry Cavill': 'Henry_Cavill',
  'Elon Musk': 'Elon_Musk',
  'Bruce Lee': 'Bruce_Lee',
  Lucifer: 'Tom_Ellis_(actor)',
  'The Mentalist': 'Simon_Baker',
  'Iron Man': 'Robert_Downey_Jr.',
  'Ben Affleck': 'Ben_Affleck',
};

async function faces() {
  const out = {};
  await Promise.all(
    Object.entries(FACES).map(async ([who, page]) => {
      try {
        const s = await fetchJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page)}`);
        if (s.thumbnail?.source) out[who] = { src: s.thumbnail.source, url: s.content_urls?.desktop?.page };
      } catch {
        /* no photo for this one */
      }
    }),
  );
  return out;
}

export async function people() {
  const errors = [];
  const lists = await Promise.all(
    PEOPLE.map(async ([q, who, limit = 10]) => {
      try {
        const items = await fetchFeed(gnews(`${q} when:7d`), 'Google News');
        return items.slice(0, limit).map((i) => ({ ...i, badge: who, summary: '' }));
      } catch (err) {
        errors.push(`${who}: ${err.message}`);
        return [];
      }
    }),
  );
  // Round-robin by person so Musk headlines don't bury everyone else.
  const queues = lists.map((l) => dedupeSort(l, 10));
  const items = [];
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) items.push(q.shift());
  return { items: dedupeSort(items, 50), faces: await faces(), errors };
}

export async function books() {
  const list = JSON.parse(await readFile(new URL('../data/books.json', import.meta.url), 'utf8'));
  // Covers come straight from the Open Library covers CDN by ISBN; default=false makes a
  // missing cover a 404 so the page can fall back to a text tile.
  const withCovers = list.map((b) => ({
    ...b,
    cover: `https://covers.openlibrary.org/b/isbn/${b.isbn}-M.jpg?default=false`,
    url: `https://openlibrary.org/isbn/${b.isbn}`,
  }));
  let zen = null;
  try {
    const [z] = await fetchJSON('https://zenquotes.io/api/today');
    zen = { q: z.q, a: z.a };
  } catch {
    /* curated quotes cover this */
  }
  return { items: [], books: withCovers, zen };
}
