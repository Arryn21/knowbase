import { gatherFeeds, dedupeSort, interleave, clip } from '../lib/feeds.mjs';
import { fetchJSON } from '../lib/http.mjs';

export async function cyber_news() {
  const { items, errors } = await gatherFeeds([
    ['https://feeds.feedburner.com/TheHackersNews', 'The Hacker News'],
    ['https://www.bleepingcomputer.com/feed/', 'BleepingComputer'],
    ['https://krebsonsecurity.com/feed/', 'Krebs on Security', 6],
    ['https://www.darkreading.com/rss.xml', 'Dark Reading'],
    ['https://www.securityweek.com/feed/', 'SecurityWeek'],
    ['https://therecord.media/feed', 'The Record'],
  ]);
  return { items: interleave(dedupeSort(items, 200, { maxAgeHours: 96 }), 45), errors };
}

export async function vulns() {
  const errors = [];
  const items = [];

  try {
    const kev = await fetchJSON(
      'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    );
    kev.vulnerabilities
      .sort((a, b) => b.dateAdded.localeCompare(a.dateAdded))
      .slice(0, 25)
      .forEach((v) =>
        items.push({
          title: `${v.cveID}: ${v.vendorProject} ${v.product}`,
          url: `https://nvd.nist.gov/vuln/detail/${v.cveID}`,
          source: 'CISA KEV',
          time: new Date(v.dateAdded + 'T12:00:00Z').toISOString(),
          badge: v.knownRansomwareCampaignUse === 'Known' ? 'KEV · ransomware' : 'KEV',
          summary: clip(v.vulnerabilityName + '. ' + v.shortDescription, 200),
        }),
      );
  } catch (err) {
    errors.push(`CISA KEV: ${err.message}`);
  }

  try {
    const end = new Date();
    const start = new Date(end.getTime() - 3 * 864e5);
    const iso = (d) => d.toISOString().replace('Z', '');
    const headers = process.env.NVD_API_KEY ? { apiKey: process.env.NVD_API_KEY } : {};
    const nvd = await fetchJSON(
      `https://services.nvd.nist.gov/rest/json/cves/2.0?pubStartDate=${iso(start)}&pubEndDate=${iso(end)}&cvssV3Severity=CRITICAL`,
      { headers, timeout: 30000 },
    );
    for (const { cve } of nvd.vulnerabilities || []) {
      const m = cve.metrics?.cvssMetricV31?.[0] || cve.metrics?.cvssMetricV30?.[0];
      const desc = cve.descriptions?.find((d) => d.lang === 'en')?.value || '';
      items.push({
        title: cve.id,
        url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
        source: 'NVD critical',
        time: new Date(cve.published + 'Z').toISOString(),
        badge: m ? `CVSS ${m.cvssData.baseScore}` : 'CRITICAL',
        summary: clip(desc, 200),
      });
    }
  } catch (err) {
    errors.push(`NVD: ${err.message}`);
  }

  return { items: dedupeSort(items, 60), errors };
}

export async function ransomware() {
  const { items, errors } = await gatherFeeds([['https://www.ransomware.live/rss.xml', 'ransomware.live', 40]]);
  // Titles look like "🏴‍☠️ group has just published a new victim : name"
  items.forEach((i) => {
    const m = i.title.match(/^\W*(\S+)\s+has just published a new victim\s*:\s*(.+)$/i);
    if (m) {
      i.badge = m[1];
      i.title = m[2];
    }
    i.summary = clip(i.summary, 160);
  });
  return { items: dedupeSort(items, 40), errors };
}

export async function ctf() {
  const now = Math.floor(Date.now() / 1000);
  const events = await fetchJSON(
    `https://ctftime.org/api/v1/events/?limit=40&start=${now - 3 * 86400}&finish=${now + 45 * 86400}`,
  );
  const items = events
    .filter((e) => Date.parse(e.finish) > Date.now())
    .map((e) => {
      const live = Date.parse(e.start) <= Date.now();
      return {
        title: e.title,
        url: e.ctftime_url || e.url,
        source: e.format || 'CTF',
        time: e.start,
        end: e.finish,
        badge: live ? 'LIVE' : e.onsite ? 'onsite' : 'online',
        meta: [e.weight ? `weight ${e.weight.toFixed(1)}` : '', e.participants ? `${e.participants} teams` : '']
          .filter(Boolean)
          .join(' · '),
        upcoming: true,
      };
    })
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  return { items };
}
