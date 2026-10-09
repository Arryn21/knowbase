// Fills in a picture for stories whose feed didn't include one, by reading the
// article's og:image / twitter:image tag. Results (including misses) are cached
// across runs in cache.json so each article is fetched at most once.
import { fetchText } from './http.mjs';

const TTL_MS = 7 * 864e5;

function metaImage(html, pageUrl) {
  const head = html.slice(0, 200000);
  const m =
    head.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["']/i) ||
    head.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
  if (!m) return null;
  try {
    const url = new URL(m[1].replace(/&amp;/g, '&'), pageUrl);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * @param items  pane items (mutated: gains .image)
 * @param cache  { [articleUrl]: { img, t } }
 * @param budget { left } shared across panes so one run can't make hundreds of requests
 */
export async function fillImages(items, cache, budget) {
  const todo = [];
  for (const it of items) {
    if (it.image || !it.url) continue;
    const host = new URL(it.url).hostname;
    // Google News links are redirects that need JavaScript; nothing to read there.
    if (host === 'news.google.com') continue;
    const hit = cache[it.url];
    if (hit && Date.now() - hit.t < TTL_MS) {
      if (hit.img) it.image = hit.img;
      continue;
    }
    if (budget.left <= 0) break;
    budget.left--;
    todo.push(it);
  }
  // A few at a time, short timeout, no retries.
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(
      todo.slice(i, i + 6).map(async (it) => {
        let img = null;
        try {
          img = metaImage(await fetchText(it.url, { timeout: 7000, retries: 0 }), it.url);
        } catch {
          /* leave it imageless */
        }
        cache[it.url] = { img, t: Date.now() };
        if (img) it.image = img;
      }),
    );
  }
}

export function pruneImageCache(cache) {
  for (const [k, v] of Object.entries(cache)) if (Date.now() - v.t > TTL_MS) delete cache[k];
}
