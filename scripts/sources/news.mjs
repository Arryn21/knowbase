import { gatherFeeds, dedupeSort, interleave } from '../lib/feeds.mjs';

const gnews = (q, region = 'US') =>
  region === 'IN'
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`
    : `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

async function newsPane(feeds, limit = 45) {
  const { items, errors } = await gatherFeeds(feeds);
  return { items: interleave(dedupeSort(items, 200, { maxAgeHours: 48 }), limit), errors };
}

export const india = () =>
  newsPane([
    ['https://www.thehindu.com/news/national/feeder/default.rss', 'The Hindu'],
    ['https://indianexpress.com/section/india/feed/', 'Indian Express'],
    ['https://feeds.feedburner.com/ndtvnews-india-news', 'NDTV'],
    ['https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms', 'Times of India'],
    ['https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en', 'Google News IN', 20],
  ]);

export const world = () =>
  newsPane([
    ['https://feeds.bbci.co.uk/news/world/rss.xml', 'BBC'],
    ['https://www.aljazeera.com/xml/rss/all.xml', 'Al Jazeera'],
    ['https://www.theguardian.com/world/rss', 'The Guardian'],
    ['https://feeds.npr.org/1004/rss.xml', 'NPR'],
    ['https://rss.dw.com/rdf/rss-en-world', 'DW'],
  ]);

export const usa = () =>
  newsPane([
    ['https://feeds.npr.org/1001/rss.xml', 'NPR'],
    ['https://rss.nytimes.com/services/xml/rss/nyt/US.xml', 'NYT'],
    ['https://www.cbsnews.com/latest/rss/us', 'CBS'],
    ['https://abcnews.go.com/abcnews/usheadlines', 'ABC'],
    ['https://www.pbs.org/newshour/feeds/rss/headlines', 'PBS NewsHour'],
  ]);

export { gnews, newsPane };
