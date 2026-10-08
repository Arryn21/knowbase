# knowbase

Live news and knowledge board for `knowbase.vishaltharu.com`.

A GitHub Actions job runs every 15 minutes. It fetches about 60 sources, writes
`public/data/feeds.json`, and deploys `public/` to GitHub Pages. The page is static HTML,
CSS and JS with no build step. It auto-scrolls each pane and polls for fresh data every
5 minutes.

## Panes

| Group | Panes | Sources |
|---|---|---|
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
- Keyboard: `P` pauses or resumes all auto-scrolling. Hovering a pane also pauses it.
- The mouse wheel always scrolls the page. Click inside a pane (or Tab to it) to scroll that pane; moving the pointer out or pressing Esc gives the wheel back to the page.
