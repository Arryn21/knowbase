// Reddit blocks anonymous requests from cloud IPs (GitHub Actions gets HTTP 429), so when
// REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are set we use the official API with an
// application-only OAuth token instead of the public RSS feeds.
let cached = null;

export const redditConfigured = () => !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);

// Reddit asks for a descriptive user agent that names the app and its owner.
const userAgent = () => `web:knowbase:1.0 (by /u/${process.env.REDDIT_USERNAME || 'knowbase'})`;

async function token() {
  if (cached && cached.expires > Date.now() + 60000) return cached.token;
  const basic = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': userAgent(),
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Reddit auth HTTP ${res.status}`);
  const j = await res.json();
  if (!j.access_token) throw new Error(`Reddit auth failed: ${j.error || 'no token'}`);
  cached = { token: j.access_token, expires: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

/** Top posts of a subreddit, shaped like parseFeed() items. */
export async function redditTop(sub, period, source) {
  const res = await fetch(`https://oauth.reddit.com/r/${sub}/top?t=${period}&limit=25&raw_json=1`, {
    headers: { authorization: `Bearer ${await token()}`, 'user-agent': userAgent() },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Reddit API HTTP ${res.status}`);
  const j = await res.json();
  return (j.data?.children || [])
    .map((c) => c.data)
    .filter((p) => !p.stickied && !p.over_18)
    .map((p) => ({
      title: p.title,
      url: `https://www.reddit.com${p.permalink}`,
      source,
      time: new Date(p.created_utc * 1000).toISOString(),
      summary: '',
      badge: `▲ ${p.score}`,
      _raw: {},
    }));
}
