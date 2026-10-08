import { gatherFeeds, dedupeSort, interleave, clip } from '../lib/feeds.mjs';
import { fetchJSON, githubHeaders } from '../lib/http.mjs';

export async function hn() {
  const { hits } = await fetchJSON('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=40');
  const items = hits
    .sort((a, b) => b.points - a.points)
    .map((h) => ({
      title: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      source: h.url ? new URL(h.url).hostname.replace(/^www\./, '') : 'news.ycombinator.com',
      time: h.created_at,
      badge: `▲ ${h.points}`,
      meta: `${h.num_comments ?? 0} comments`,
      discuss: `https://news.ycombinator.com/item?id=${h.objectID}`,
    }));
  return { items };
}

export async function github_trending() {
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const res = await fetchJSON(
    `https://api.github.com/search/repositories?q=created:%3E${since}&sort=stars&order=desc&per_page=35`,
    { headers: githubHeaders() },
  );
  const items = res.items.map((r) => ({
    title: r.full_name,
    url: r.html_url,
    source: r.language || 'repo',
    time: r.created_at,
    badge: `★ ${r.stargazers_count >= 1000 ? (r.stargazers_count / 1000).toFixed(1) + 'k' : r.stargazers_count}`,
    summary: clip(r.description || '', 160),
  }));
  return { items };
}

export async function community() {
  const { items, errors } = await gatherFeeds([
    ['https://lobste.rs/rss', 'Lobsters', 20],
    ['https://www.reddit.com/r/netsec/top/.rss?t=day', 'r/netsec', 12],
    ['https://www.reddit.com/r/networking/top/.rss?t=day', 'r/networking', 8],
  ]);
  items.forEach((i) => (i.summary = ''));
  return { items: interleave(dedupeSort(items, 100, { maxAgeHours: 72 }), 40), errors };
}

const STATUS_PAGES = [
  ['Claude', 'https://status.claude.com'],
  ['OpenAI', 'https://status.openai.com'],
  ['GitHub', 'https://www.githubstatus.com'],
  ['Cloudflare', 'https://www.cloudflarestatus.com'],
  ['Discord', 'https://discordstatus.com'],
];

export async function status() {
  const items = await Promise.all(
    STATUS_PAGES.map(async ([name, base]) => {
      try {
        const s = await fetchJSON(`${base}/api/v2/status.json`, { timeout: 10000 });
        return { name, url: base, indicator: s.status.indicator, description: s.status.description };
      } catch {
        return { name, url: base, indicator: 'unknown', description: 'Status unavailable' };
      }
    }),
  );
  return { items };
}

const TICKERS = [
  ['^NSEI', 'Nifty 50'],
  ['^BSESN', 'Sensex'],
  ['^GSPC', 'S&P 500'],
  ['^IXIC', 'Nasdaq'],
  ['INR=X', 'USD/INR'],
];

export async function markets() {
  const errors = [];
  const quotes = await Promise.all(
    TICKERS.map(async ([sym, name]) => {
      try {
        const j = await fetchJSON(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1h`,
        );
        const m = j.chart.result[0].meta;
        const prev = m.chartPreviousClose ?? m.previousClose;
        return {
          name,
          symbol: sym,
          price: m.regularMarketPrice,
          change: prev ? ((m.regularMarketPrice - prev) / prev) * 100 : null,
          url: `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}`,
        };
      } catch (err) {
        errors.push(`${name}: ${err.message}`);
        return null;
      }
    }),
  );
  try {
    const cg = await fetchJSON(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true',
    );
    quotes.push(
      { name: 'BTC', symbol: 'BTC', price: cg.bitcoin.usd, change: cg.bitcoin.usd_24h_change, url: 'https://www.coingecko.com/en/coins/bitcoin' },
      { name: 'ETH', symbol: 'ETH', price: cg.ethereum.usd, change: cg.ethereum.usd_24h_change, url: 'https://www.coingecko.com/en/coins/ethereum' },
    );
  } catch (err) {
    errors.push(`CoinGecko: ${err.message}`);
  }
  return { items: quotes.filter(Boolean), errors };
}
