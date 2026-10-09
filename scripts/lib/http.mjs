// Small fetch wrapper: browser-like UA, timeout, one retry on 429/5xx.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 knowbase/1.0';

// Error messages end up in the published feeds.json, so never let a key in a URL into one.
const redact = (url) => String(url).replace(/([?&](?:api_key|apikey|key|token|access_token|client_secret)=)[^&]+/gi, '$1***');

export async function fetchText(url, { headers = {}, timeout = 20000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: '*/*', ...headers },
        signal: AbortSignal.timeout(timeout),
      });
      if (res.ok) return await res.text();
      lastErr = new Error(`HTTP ${res.status} for ${redact(url)}`);
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      lastErr = err;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw lastErr;
}

export async function fetchJSON(url, opts) {
  return JSON.parse(await fetchText(url, opts));
}

export function githubHeaders() {
  const h = { accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}
