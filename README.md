# knowbase

Live news and knowledge board for `knowbase.vishaltharu.com`.

A GitHub Actions job runs every 15 minutes. It fetches about 60 sources, writes
`public/data/feeds.json`, and deploys `public/` to GitHub Pages. The page is static HTML,
CSS and JS with no build step. It auto-scrolls each pane and polls for fresh data every
5 minutes.

## Panes

| Group | Panes | Sources |
|---|---|---|
| Today | Quote of the day, three daily 1% challenges, habit checklist with streak and 7-day history, book of the week; panes for mind and character, body and personal care, people you follow | `public/growth.json` (challenges, quotes, default habits), `scripts/data/books.json`, James Clear, Farnam Street, Mark Manson, Psyche, Daily Stoic, Ryan Holiday, Cal Newport, Greater Good, Art of Manliness, Nerd Fitness, Peter Attia, Men's Health, Huberman Lab, Google News, ZenQuotes, Open Library covers |
| News | India, World, USA | The Hindu, Indian Express, NDTV, TOI, Google News IN, BBC, Al Jazeera, Guardian, NPR, DW, NYT, CBS, ABC, PBS |
| AI | AI news, research papers, techniques, new models and pricing, Hugging Face trending, tool releases | Google News (Anthropic / OpenAI / open-weight), Verge, TechCrunch, OpenAI, DeepMind, r/LocalLLaMA, HF Daily Papers, arXiv cs.CR + cs.NI, Simon Willison, PortSwigger, Trail of Bits, Project Zero, Lil'Log, Raschka, OpenRouter, GitHub releases |
| Security | News, exploited and critical CVEs, ransomware victims, CTF calendar | THN, BleepingComputer, Krebs, Dark Reading, SecurityWeek, The Record, CISA KEV, NVD, ransomware.live, CTFtime |
| Pulse | Hacker News, GitHub new and rising, Lobsters and Reddit | HN Algolia API, GitHub search API, Lobsters, r/netsec, r/networking |
| Chess | News, live and upcoming events, lessons and tips, daily puzzle (board drawn from the Lichess FEN) | ChessBase, Chess.com news and articles, FIDE, r/chess, Lichess blog, Lichess broadcasts, Lichess and Chess.com daily puzzles |
| Around LA | Free and cheap events (≤ $20, 14 days, sorted by distance from 90746), earthquakes, launches | Luma, Eventbrite, Meetup, We Like L.A., Secret LA, LA Times, LAist (articles parsed by Claude), USGS, Launch Library 2 |
| Knowledge | Concept of the day, ATT&CK technique of the day, Wikipedia featured / in the news / on this day | Wikipedia REST API, MITRE ATT&CK STIX |
| Top strip | Clocks, Carson weather and AQI, markets, service status | Open-Meteo (client side), Yahoo Finance, CoinGecko, Statuspage APIs |

Each pane has its own refresh interval (`PANES` in `scripts/build-data.mjs`). If a source
fails, the pane keeps its last good data and shows its update time in red.

## Pictures and graphics

- Story images come from the feeds themselves (`media:content`, enclosures, inline `<img>`). For the top 14 stories in most panes without one, the build reads the article's `og:image` (cached in `data/cache.json`, at most 90 new fetches per run). Google News links can't be resolved, so those rows show the publisher's logo instead. The ransomware pane is deliberately text-only: its feed images are leak-site screenshots.
- Today's hero is Wikipedia's picture of the day (credited and linked to its Commons page). Knowledge opens on NASA's Astronomy Picture of the Day when its API has a usable image (APOD moved to science.nasa.gov and the API often returns a placeholder), otherwise on NASA's Image of the Day feed. `NASA_API_KEY` avoids the shared demo key's rate limit.
- Faces of the people you follow come from Wikipedia (`FACES` in `scripts/sources/growth.mjs`; the TV characters use their actors).
- The LA page map uses Leaflet and OpenStreetMap tiles, loaded only when that page opens.
- All animation respects the system's reduce-motion setting.

## Refresh timer

GitHub's scheduler skips most runs on this repo, so a Cloudflare Worker (`worker/`) starts
the workflow every 15 minutes through the GitHub API. GitHub's own cron stays on as an
hourly backup. The Worker needs one secret, `GH_TOKEN`: a fine-grained token for this repo
with Actions read and write. Deploy it with `npx wrangler@4 deploy` from `worker/`.

## Run locally

```bash
npm install
```

```bash
node scripts/build-data.mjs --force
```

```bash
node scripts/serve.mjs
```

Then open http://localhost:4173. To rebuild only some panes: `node scripts/build-data.mjs --only=hn,la_events`.

## Secrets and settings (GitHub repo → Settings)

| Name | Kind | Needed? | Used for |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | secret | Recommended | Pulls events out of LA "things to do" articles. Without it, events come only from Luma, Eventbrite and Meetup. |
| `NVD_API_KEY` | secret | Optional | Higher NVD rate limit. Free at nvd.nist.gov/developers/request-an-api-key |
| `KB_MODEL` | variable | Optional | Claude model for event extraction. Default `claude-opus-5-5`. Set `claude-haiku-5-5` to cut cost. |

Claude spend is capped: each article is extracted once and cached in `data/cache.json`,
and each run processes at most 6 new articles.

## Customizing

- Home location for distances: `scripts/lib/geo.mjs` and `HOME` in `public/app.js`
- Feeds per pane: `scripts/sources/*.mjs`
- Concept-of-the-day terms: `scripts/data/concepts.json`
- Event price ceiling and date window: top of `scripts/sources/events.mjs`
- Daily challenges, quotes and default habits: `public/growth.json`. Reading list: `scripts/data/books.json` (one book per week, covers by ISBN).
- Today also has an evening journal, a currently-reading tracker (logging 10+ pages ticks the reading habit), spaced-repetition review cards (add your own or use "Add to review" on the concept and ATT&CK cards) and a weekly review with stats.
- Progress is saved in the browser. **Sync** (button next to the Today heading) copies it to a private GitHub Gist, encrypted in the browser with AES-GCM using a key derived from your passphrase. Each device needs a fine-grained GitHub token with only the Gists permission (read and write) and the same passphrase. Changes merge entry by entry using timestamps, so two devices editing different days don't overwrite each other. Code: `public/sync.js` and `public/today.js`.
- **Focus** hides every news feed and keeps Today, Chess and Knowledge. The top bar counts minutes on the board today and shows a reminder after 30 minutes.
- Each section is its own page (`#today`, `#news`, `#ai`, `#security`, `#pulse`, `#chess`, `#local`, `#knowledge`), so links can be bookmarked. On wide screens the panes size themselves to fill the window, so feed pages don't scroll.
- Keyboard: `1`-`8` switch pages, `P` pauses or resumes all auto-scrolling. Hovering a pane also pauses it.
- The mouse wheel always scrolls the page. Click inside a pane (or Tab to it) to scroll that pane; moving the pointer out or pressing Esc gives the wheel back to the page.
