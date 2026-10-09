import { esc, safeUrl, store, sparkline } from './util.js';
import { initToday, renderToday, addReviewCard } from './today.js';
import { showMap, updateMap } from './map.js';

// knowbase client: renders data/feeds.json, auto-scrolls panes, polls for updates.
const DATA_URL = 'data/feeds.json';
const POLL_MS = 5 * 60 * 1000;
const SCROLL_PX_PER_SEC = 16;
const HOME = { lat: 33.8584, lon: -118.2551, label: 'Carson' };

const SUMMARY_PANES = new Set(['research', 'techniques', 'vulns', 'new_models', 'github_trending', 'releases', 'cyber_news', 'ai_news', 'chess_news', 'chess_learn']);
const PANE_ICONS = {
  india: 'ph-flag', world: 'ph-globe-hemisphere-east', usa: 'ph-flag-banner',
  ai_news: 'ph-sparkle', research: 'ph-article', techniques: 'ph-wrench', new_models: 'ph-cpu',
  hf_trending: 'ph-trend-up', releases: 'ph-package',
  cyber_news: 'ph-shield-warning', vulns: 'ph-bug', ransomware: 'ph-lock-key', ctf: 'ph-flag-checkered',
  hn: 'ph-newspaper', github_trending: 'ph-github-logo', community: 'ph-chats-circle',
  chess_news: 'ph-crown', chess_live: 'ph-broadcast', chess_learn: 'ph-graduation-cap', chess_puzzle: 'ph-puzzle-piece',
  growth_mind: 'ph-brain', growth_body: 'ph-barbell', people: 'ph-users-three',
  la_events: 'ph-map-pin', quakes: 'ph-wave-sine', launches: 'ph-rocket-launch',
};
const paneIcon = (id) => `<i class="ph ${PANE_ICONS[id] || 'ph-list'} pi" aria-hidden="true"></i>`;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- small utils ----------
function ago(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 90) return 'now'; // also covers publishers whose clocks run ahead
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function until(iso) {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  if (s <= 0) return 'live';
  if (s < 3600) return `in ${Math.round(s / 60)}m`;
  if (s < 86400) return `in ${Math.round(s / 3600)}h`;
  return `in ${Math.round(s / 86400)}d`;
}
const fmtDate = (iso, tz = 'America/Los_Angeles') =>
  new Date(iso).toLocaleString(undefined, { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// "New since your last visit" marker.
const lastVisit = store.get('kb.lastVisit', Date.now());
addEventListener('pagehide', () => store.set('kb.lastVisit', Date.now()));
setInterval(() => store.set('kb.lastVisit', Date.now()), 10 * 60 * 1000);

// ---------- pane rendering ----------
// Panes that stay text-only: CVE lists, leak-site victims and CTF dates have no useful pictures.
const NO_PICTURES = new Set(['vulns', 'ransomware', 'ctf', 'status', 'markets']);
const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
// Images come from publishers' CDNs; a broken one simply disappears.
const img = (src, cls) =>
  `<img class="${cls}" src="${safeUrl(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()" />`;
const favicon = (it) => {
  const h = hostOf(it.site || it.url);
  return h ? img(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(h)}&sz=64`, 'fav') : '';
};

function itemMeta(it, { links = true, fav = false } = {}) {
  const time = it.upcoming ? (Date.parse(it.time) > Date.now() ? until(it.time) : it.end ? 'live' : ago(it.time)) : ago(it.time);
  const live = it.badge === 'LIVE';
  const hot = /^(KEV|LIVE|FREE|CVSS (9|10))/.test(it.badge || '');
  return [
    fav ? favicon(it) : '',
    `<span class="src">${esc(it.source)}</span>`,
    time ? `<time datetime="${esc(it.time)}"${it.upcoming ? ' data-up="1"' : ''} title="${esc(it.time ? fmtDate(it.time) : '')}">${esc(time)}</time>` : '',
    it.badge ? `<span class="badge${hot ? ' hot' : ''}${live ? ' live' : ''}">${esc(it.badge)}</span>` : '',
    it.meta ? `<span>${esc(it.meta)}</span>` : '',
    links && it.discuss ? `<a href="${safeUrl(it.discuss)}" target="_blank" rel="noopener">discuss</a>` : '',
  ].join('');
}

/** One list row. ctx.lead renders the big picture card that opens a pane. */
function itemHTML(it, paneId, ctx = {}) {
  const isNew = !it.upcoming && Date.parse(it.time) > lastVisit;
  const pictures = !NO_PICTURES.has(paneId);
  if (ctx.lead) {
    return `<li class="item lead${isNew ? ' new' : ''}"><a class="lead-link" href="${safeUrl(it.url)}" target="_blank" rel="noopener">${img(it.image, 'lead-img')}<span class="lead-txt"><span class="t">${esc(it.title)}</span><span class="m">${itemMeta(it, { links: false, fav: true })}</span></span></a></li>`;
  }
  let visual = '';
  let side = 'right';
  if (paneId === 'quakes' && it.mag != null) {
    visual = `<span class="mag" style="--m:${Math.max(0, it.mag).toFixed(1)}" aria-hidden="true"></span>`;
    side = 'left';
  } else if (paneId === 'people' && ctx.faces?.[it.badge]) {
    visual = img(ctx.faces[it.badge].src, 'face');
    side = 'left';
  } else if (pictures && it.image) {
    visual = img(it.image, 'th');
  }
  const summary = SUMMARY_PANES.has(paneId) && it.summary ? `<p class="s">${esc(it.summary)}</p>` : '';
  const body = `<div class="it-body"><a class="t" href="${safeUrl(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a><div class="m">${itemMeta(it, { fav: pictures && !visual })}</div>${summary}</div>`;
  const cls = `item${isNew ? ' new' : ''}${visual ? ` has-vis vis-${side}` : ''}`;
  return `<li class="${cls}">${side === 'left' ? visual + body : body + visual}</li>`;
}

/** Pane HTML: the first well-pictured story becomes the lead card, the rest are rows. */
function paneItemsHTML(pane) {
  const items = pane.items.slice();
  const canLead = !NO_PICTURES.has(pane.id) && !['people', 'quakes'].includes(pane.id);
  const leadIdx = canLead ? items.slice(0, 4).findIndex((i) => i.image) : -1;
  const lead = leadIdx >= 0 ? items.splice(leadIdx, 1)[0] : null;
  const ctx = { faces: pane.faces };
  return (lead ? itemHTML(lead, pane.id, { lead: true }) : '') + items.map((it) => itemHTML(it, pane.id, ctx)).join('');
}

function paneShell(id, title) {
  const el = document.createElement('article');
  el.className = 'pane';
  el.id = `pane-${id}`;
  el.innerHTML = `
    <header class="pane-head">
      ${paneIcon(id)}
      <h3>${esc(title)}</h3>
      <span class="pane-meta"></span>
      <button class="pane-btn" type="button" aria-pressed="false" title="Pause this pane"><i class="ph ph-pause"></i></button>
    </header>
    <div class="viewport" tabindex="0" aria-label="${esc(title)}"><ol class="track skeleton">${'<li class="item"><div class="bar"></div><div class="bar w2"></div></li>'.repeat(8)}</ol></div>
    <span class="scroll-hint" aria-hidden="true">Click to scroll</span>`;
  makeEngageable(el.querySelector('.viewport'));
  return el;
}

// The mouse wheel belongs to the page. A pane takes the wheel only after a click inside it
// (or Tab focus), and releases it when the pointer leaves, on Esc, or on a tap elsewhere.
function makeEngageable(vp) {
  const release = () => vp.classList.remove('engaged');
  vp.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('a, button, summary')) vp.classList.add('engaged');
  });
  vp.addEventListener('focus', () => vp.classList.add('engaged'));
  vp.addEventListener('blur', release);
  vp.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && release());
  vp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      release();
      vp.blur();
    }
  });
}
document.addEventListener('pointerdown', (e) => {
  document.querySelectorAll('.viewport.engaged').forEach((v) => !v.contains(e.target) && v.classList.remove('engaged'));
});

const scrollers = new Map();

function renderPane(pane) {
  const el = document.getElementById(`pane-${pane.id}`);
  if (!el) return;
  el.querySelector('.pane-head h3').textContent = pane.title;
  const meta = el.querySelector('.pane-meta');
  meta.textContent = `${pane.items.length} · ${pane.updatedAt ? ago(pane.updatedAt) : 'never'}`;
  meta.dataset.updated = pane.updatedAt || '';
  meta.classList.toggle('stale', !!pane.stale);
  meta.title = pane.errors?.length ? `Source issues:\n${pane.errors.join('\n')}` : `Updated ${pane.updatedAt ? fmtDate(pane.updatedAt) : 'never'}`;

  const track = el.querySelector('.track');
  track.classList.remove('skeleton');
  if (!pane.items.length) {
    track.innerHTML = `<li class="empty">Nothing here yet. The next refresh runs within 15 minutes.</li>`;
    return;
  }
  scrollers.get(pane.id).reset(paneItemsHTML(pane));
}

// ---------- auto-scroll ----------
let globalPaused = store.get('kb.paused', false);

class AutoScroller {
  constructor(id, el) {
    this.el = el;
    this.viewport = el.querySelector('.viewport');
    this.track = el.querySelector('.track');
    this.btn = el.querySelector('.pane-btn');
    this.pos = 0;
    this.hover = false;
    this.userUntil = 0;
    this.visible = true;
    this.paused = store.get(`kb.paused.${id}`, false);
    this.syncBtn();
    this.btn.addEventListener('click', () => {
      this.paused = !this.paused;
      store.set(`kb.paused.${id}`, this.paused);
      this.syncBtn();
    });
    const pauseForUser = () => (this.userUntil = performance.now() + 10000);
    this.viewport.addEventListener('pointerenter', () => (this.hover = true));
    this.viewport.addEventListener('pointerleave', () => (this.hover = false));
    this.viewport.addEventListener('focusin', () => (this.hover = true));
    this.viewport.addEventListener('focusout', () => (this.hover = false));
    this.viewport.addEventListener('wheel', pauseForUser, { passive: true });
    this.viewport.addEventListener('touchstart', pauseForUser, { passive: true });
    this.viewport.addEventListener('keydown', pauseForUser);
    new IntersectionObserver(([e]) => (this.visible = e.isIntersecting)).observe(this.viewport);
  }
  syncBtn() {
    this.btn.setAttribute('aria-pressed', String(this.paused));
    this.btn.innerHTML = `<i class="ph ${this.paused ? 'ph-play' : 'ph-pause'}"></i>`;
    this.btn.title = this.paused ? 'Resume this pane' : 'Pause this pane';
  }
  // Duplicate the list once so the loop wraps seamlessly; the copy is hidden from AT and tab order.
  reset(html) {
    this.html = html;
    const keep = this.viewport.scrollTop;
    this.track.innerHTML = html;
    this.half = 0;
    if (this.track.scrollHeight > this.viewport.clientHeight * 1.2) {
      this.half = this.track.scrollHeight;
      this.track.insertAdjacentHTML('beforeend', html.replace(/<a /g, '<a tabindex="-1" '));
      [...this.track.children].slice(this.track.children.length / 2).forEach((li) => li.setAttribute('aria-hidden', 'true'));
    }
    this.viewport.scrollTop = this.pos = Math.min(keep, this.half || keep);
  }
  // Panes rendered on a hidden page measure zero height; re-measure once they're visible.
  refit() {
    this.visible = true; // its page was just shown; the IntersectionObserver catches up later
    if (this.html) this.reset(this.html);
  }
  tick(dt, now) {
    const active =
      !globalPaused && !this.paused && !this.hover && this.visible && now > this.userUntil && !reduceMotion.matches &&
      !this.viewport.classList.contains('engaged');
    if (!active || !this.half) {
      this.pos = this.viewport.scrollTop;
      return;
    }
    this.pos += (SCROLL_PX_PER_SEC * dt) / 1000;
    if (this.pos >= this.half) this.pos -= this.half;
    this.viewport.scrollTop = this.pos;
  }
}

let lastT = performance.now();
function loop(now) {
  const dt = Math.min(now - lastT, 100);
  lastT = now;
  if (!document.hidden) scrollers.forEach((s) => s.tick(dt, now));
  requestAnimationFrame(loop);
}

const pauseAllBtn = document.getElementById('pauseAll');
function syncPauseAll() {
  pauseAllBtn.setAttribute('aria-pressed', String(globalPaused));
  pauseAllBtn.innerHTML = globalPaused
    ? '<i class="ph ph-play" aria-hidden="true"></i><span>Resume</span>'
    : '<i class="ph ph-pause" aria-hidden="true"></i><span>Pause</span>';
  pauseAllBtn.title = `${globalPaused ? 'Resume' : 'Pause'} auto-scroll in every pane (shortcut: P)`;
}
function togglePauseAll() {
  globalPaused = !globalPaused;
  store.set('kb.paused', globalPaused);
  syncPauseAll();
}
pauseAllBtn.addEventListener('click', togglePauseAll);
addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key.toLowerCase() === 'p') togglePauseAll();
  const n = Number(e.key);
  if (n >= 1 && n <= PAGES.length) location.hash = PAGES[n - 1];
});

// ---------- strip: markets, status, freshness ----------
function renderStrip(data) {
  const m = data.panes.markets?.items || [];
  const tickerHTML = m
    .map((q) => {
      const dir = q.change > 0.005 ? 'up' : q.change < -0.005 ? 'down' : '';
      const val = q.price >= 1000 ? q.price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : q.price.toLocaleString(undefined, { maximumFractionDigits: 2 });
      const chg = q.change == null ? '' : `${q.change > 0 ? '+' : ''}${q.change.toFixed(2)}%`;
      return `<a class="ticker" href="${safeUrl(q.url)}" target="_blank" rel="noopener"><span class="n">${esc(q.name)}</span>${sparkline(q.spark, { cls: dir })}<span class="v">${esc(val)}</span><span class="c ${dir}">${esc(chg)}</span></a>`;
    })
    .join('');
  // The ticker scrolls as a loop: the second copy is decorative and hidden from assistive tech.
  const tickers = document.getElementById('tickers');
  tickers.innerHTML = `<div class="ticker-track">${tickerHTML}<span class="ticker-copy" aria-hidden="true">${tickerHTML.replace(/<a /g, '<a tabindex="-1" ')}</span></div>`;
  const track = tickers.firstElementChild;
  track.style.setProperty('--ticker-dur', `${Math.max(20, track.scrollWidth / 2 / 45)}s`);
  const s = data.panes.status?.items || [];
  document.getElementById('statuses').innerHTML = s
    .map((x) => `<a class="status" data-s="${esc(x.indicator)}" href="${safeUrl(x.url)}" target="_blank" rel="noopener" title="${esc(x.description)}">${esc(x.name)}</a>`)
    .join('');
  renderFreshness(data);
}
function renderFreshness(data) {
  document.getElementById('freshness').textContent = data ? `data ${ago(data.generatedAt)} ago`.replace('now ago', 'just now') : '';
}

// ---------- clocks & weather ----------
const CLOCKS = [
  ['LA', 'America/Los_Angeles'],
  ['India', 'Asia/Kolkata'],
  ['UTC', 'UTC'],
  ['NYC', 'America/New_York'],
];
function renderClocks() {
  const now = new Date();
  document.getElementById('clocks').innerHTML = CLOCKS.map(([label, tz]) => {
    const t = now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
    const d = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
    return `<div class="clock"><b>${t}</b><span>${label} ${d}</span></div>`;
  }).join('');
}

const WX = {
  0: ['Clear', 'ph-sun'], 1: ['Mostly clear', 'ph-sun'], 2: ['Partly cloudy', 'ph-cloud-sun'], 3: ['Overcast', 'ph-cloud'],
  45: ['Fog', 'ph-cloud-fog'], 48: ['Fog', 'ph-cloud-fog'], 51: ['Drizzle', 'ph-cloud-rain'], 53: ['Drizzle', 'ph-cloud-rain'],
  55: ['Drizzle', 'ph-cloud-rain'], 61: ['Rain', 'ph-cloud-rain'], 63: ['Rain', 'ph-cloud-rain'], 65: ['Heavy rain', 'ph-cloud-rain'],
  80: ['Showers', 'ph-cloud-rain'], 81: ['Showers', 'ph-cloud-rain'], 82: ['Heavy showers', 'ph-cloud-rain'],
  95: ['Thunderstorm', 'ph-cloud-lightning'], 96: ['Thunderstorm', 'ph-cloud-lightning'], 99: ['Thunderstorm', 'ph-cloud-lightning'],
};
async function renderWeather() {
  const el = document.getElementById('weather');
  try {
    const q = `latitude=${HOME.lat}&longitude=${HOME.lon}&timezone=America%2FLos_Angeles`;
    const [w, a] = await Promise.all([
      fetch(`https://api.open-meteo.com/v1/forecast?${q}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&forecast_days=1`).then((r) => r.json()),
      fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=us_aqi`).then((r) => r.json()).catch(() => null),
    ]);
    const [label, icon] = WX[w.current.weather_code] || ['', 'ph-thermometer'];
    const aqi = a?.current?.us_aqi;
    el.innerHTML = `<i class="ph ${icon}"></i><div><b>${Math.round(w.current.temperature_2m)}°F</b> <span class="wx-extra">${esc(label)}</span><br><span class="wx-extra">${HOME.label} ${Math.round(w.daily.temperature_2m_max[0])}/${Math.round(w.daily.temperature_2m_min[0])}${aqi != null ? ` · AQI ${Math.round(aqi)}` : ''}</span></div>`;
    el.title = `${HOME.label} weather: ${label}`;
  } catch {
    el.textContent = '';
  }
}

// ---------- LA events ----------
const evState = Object.assign({ when: 'week', dist: 'any', price: 'all', cat: 'all' }, store.get('kb.events', {}));
let evData = null;

const ptToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
const addDays = (ymd, n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date(Date.parse(ymd + 'T12:00:00Z') + n * 864e5));
function windowFor(when) {
  const t = ptToday();
  if (when === 'today') return [t, t];
  if (when === 'weekend') {
    const dow = new Date(t + 'T12:00:00Z').getUTCDay(); // 0 Sun .. 6 Sat
    const fri = addDays(t, dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow);
    return [fri < t ? t : fri, addDays(fri, 2)];
  }
  if (when === 'week') return [t, addDays(t, 7)];
  return [t, addDays(t, 14)];
}

function seg(name, options) {
  return `<div class="seg" role="group" aria-label="${esc(name)}">${options
    .map(([v, l]) => `<button type="button" data-k="${name}" data-v="${v}" aria-pressed="${evState[name] === v}">${l}</button>`)
    .join('')}</div>`;
}

function renderEventsShell() {
  const el = document.getElementById('pane-la_events');
  el.innerHTML = `
    <header class="pane-head">${paneIcon('la_events')}<h3>Free and cheap in LA</h3><span class="pane-meta"></span></header>
    <div class="ev-controls">
      ${seg('when', [['today', 'Today'], ['weekend', 'Weekend'], ['week', '7 days'], ['all', '14 days']])}
      ${seg('dist', [['10', '≤10 mi'], ['25', '≤25 mi'], ['any', 'Any']])}
      ${seg('price', [['free', 'Free'], ['all', '≤$20']])}
      <select aria-label="Category" data-k="cat"></select>
    </div>
    <div class="ev-map" id="evMap" role="region" aria-label="Map of LA events and earthquakes near Carson"></div>
    <div class="viewport" tabindex="0" aria-label="LA events"><div class="ev-list"><div class="empty">Loading events…</div></div></div>
    <span class="scroll-hint" aria-hidden="true">Click to scroll</span>`;
  makeEngageable(el.querySelector('.viewport'));
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.seg button');
    if (b) {
      evState[b.dataset.k] = b.dataset.v;
      el.querySelectorAll(`.seg button[data-k="${b.dataset.k}"]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      store.set('kb.events', evState);
      renderEvents();
    }
    const ics = e.target.closest('.ics');
    if (ics) downloadICS(evData.items[Number(ics.dataset.i)]);
  });
  el.querySelector('select').addEventListener('change', (e) => {
    evState.cat = e.target.value;
    store.set('kb.events', evState);
    renderEvents();
  });
}

function renderEvents(pane) {
  if (pane) evData = pane;
  if (!evData) return;
  const el = document.getElementById('pane-la_events');
  const meta = el.querySelector('.pane-meta');
  meta.textContent = `${evData.items.length} · ${ago(evData.updatedAt)}`;
  meta.title = evData.errors?.length ? `Source issues:\n${evData.errors.join('\n')}` : '';

  const cats = [...new Set(evData.items.map((e) => e.category))].sort();
  const sel = el.querySelector('select');
  sel.innerHTML = `<option value="all">All types</option>${cats.map((c) => `<option value="${esc(c)}"${evState.cat === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}`;

  const [from, to] = windowFor(evState.when);
  const maxMi = evState.dist === 'any' ? Infinity : Number(evState.dist);
  const list = evData.items
    .map((e, i) => ({ ...e, i }))
    .filter((e) => e.endDay >= from && e.startDay <= to)
    .filter((e) => e.miles == null ? evState.dist === 'any' : e.miles <= maxMi)
    .filter((e) => evState.price === 'all' || e.free === true)
    .filter((e) => evState.cat === 'all' || e.category === evState.cat);
  updateMap(list, (current?.panes.quakes?.items || []).filter((q) => q.source === 'SoCal' && q.lat != null));

  const byDay = new Map();
  for (const e of list) {
    const day = e.startDay < from ? from : e.startDay;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(e);
  }
  const dayLabel = (ymd) =>
    ymd === ptToday() ? 'Today' : new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });

  const rows = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, evs]) => `<div class="ev-day">${esc(dayLabel(day))} · ${evs.length}</div>${evs.map(eventHTML).join('')}`)
    .join('');

  const places = (evData.places || [])
    .slice()
    .sort((a, b) => a.miles - b.miles)
    .map((p) => `<li><a href="${safeUrl(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a><span>${esc(p.area)} · ${p.miles} mi · ${esc(p.note)}</span></li>`)
    .join('');

  el.querySelector('.ev-list').innerHTML =
    (rows || `<div class="empty">No events match these filters. Try a wider date range or distance.</div>`) +
    (places ? `<div class="places"><h4>Free most days (check hours before you go)</h4><ul>${places}</ul></div>` : '');
}

function eventHTML(e) {
  const when = e.allDay
    ? [e.timeText, e.endDay !== e.startDay ? `through ${new Date(e.endDay + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })}` : ''].filter(Boolean).join(' · ')
    : new Date(e.start).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
  const price = e.free ? '<span class="badge free">FREE</span>' : `<span class="badge">${esc(e.priceText || '$?')}</span>`;
  const where = [e.venue, e.area].filter(Boolean).join(', ');
  return `<div class="ev${e.image ? ' has-img' : ''}">
    ${e.image ? img(e.image, 'ev-img') : ''}
    <a class="t" href="${safeUrl(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>
    <div class="m">${when ? `<span>${esc(when)}</span>` : ''}${where ? `<span>${esc(where)}</span>` : ''}<span>${esc(e.source)}${e.approval ? ' · approval' : ''}</span><span>${esc(e.category)}</span></div>
    ${e.summary ? `<p class="s">${esc(e.summary)}</p>` : ''}
    <div class="ev-side">${price}${e.miles != null ? `<span class="mi">${e.approxGeo ? '~' : ''}${e.miles} mi</span>` : ''}<button class="ics" type="button" data-i="${e.i}" title="Add to calendar"><i class="ph ph-calendar-plus"></i>.ics</button></div>
  </div>`;
}

function downloadICS(e) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  const icsText = (s) => String(s || '').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  let dt;
  if (e.allDay) {
    const end = new Date(Date.parse(e.endDay + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10).replace(/-/g, '');
    dt = `DTSTART;VALUE=DATE:${e.startDay.replace(/-/g, '')}\r\nDTEND;VALUE=DATE:${end}`;
  } else {
    const s = new Date(e.start);
    const en = e.end ? new Date(e.end) : new Date(s.getTime() + 2 * 3600e3);
    dt = `DTSTART:${stamp(s)}\r\nDTEND:${stamp(en)}`;
  }
  const body = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//knowbase//events//EN', 'BEGIN:VEVENT',
    `UID:${Date.now()}-${Math.random().toString(36).slice(2)}@knowbase`, `DTSTAMP:${stamp(new Date())}`, dt,
    `SUMMARY:${icsText(e.title)}`, `LOCATION:${icsText([e.venue, e.area].filter(Boolean).join(', '))}`,
    `URL:${safeUrl(e.url)}`, `DESCRIPTION:${icsText([e.priceText, e.summary, e.url].filter(Boolean).join('\n'))}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
  a.download = `${e.title.replace(/[^\w]+/g, '-').slice(0, 50)}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- knowledge ----------
let conceptIdx = 0;
function renderKnowledge(data) {
  const p = data.panes;
  const cards = [];
  const apod = p.apod?.apod;
  if (apod) {
    cards.push(`<article class="card hero-card" style="--hero:url('${esc(safeUrl(apod.src))}')">
      <div class="hero-txt">
        <h3>Astronomy picture of the day</h3>
        <p class="hero-title"><a href="${safeUrl(apod.url)}" target="_blank" rel="noopener">${esc(apod.title)}</a></p>
        <p class="hero-sub">${esc(apod.explanation)}</p>
      </div>
      <a class="hero-credit" href="${safeUrl(apod.url)}" target="_blank" rel="noopener">Image: ${esc(apod.credit)} · NASA APOD</a>
    </article>`);
  }
  const concepts = p.concept?.cards || [];
  if (concepts.length) {
    const c = concepts[conceptIdx % concepts.length];
    cards.push(`<article class="card card-concept">
      <h3>${conceptIdx === 0 ? 'Concept of the day' : 'Coming up'}</h3>
      <p class="big"><small>${esc(c.track)}</small>${esc(c.term)}</p>
      <p>${esc(c.extract)}</p>
      <div class="concept-nav">
        <a class="badge" href="${safeUrl(c.url)}" target="_blank" rel="noopener">Read on Wikipedia</a>
        <button class="badge" type="button" data-review="concept">Add to review</button>
        ${concepts.length > 1 ? `<button class="badge" type="button" id="nextConcept">Next concept</button>` : ''}
      </div></article>`);
  }
  const t = p.attack?.technique;
  if (t) {
    cards.push(`<article class="card card-attack">
      <h3>MITRE ATT&amp;CK technique of the day</h3>
      <p class="big"><small>${esc(t.id)}</small><a href="${safeUrl(t.url)}" target="_blank" rel="noopener">${esc(t.name)}</a></p>
      <div class="tags">${t.tactics.map((x) => `<span class="badge hot">${esc(x)}</span>`).join('')}${t.platforms.slice(0, 4).map((x) => `<span class="badge">${esc(x)}</span>`).join('')}</div>
      <p>${esc(t.description)}</p>
      ${t.detection ? `<p><b>Detection:</b> ${esc(t.detection)}</p>` : ''}
      <div class="concept-nav"><button class="badge" type="button" data-review="attack">Add to review</button></div></article>`);
  }
  const w = p.wikipedia;
  if (w?.featured) {
    cards.push(`<article class="card card-featured">
      <h3>Wikipedia featured article</h3>
      ${w.featured.thumb ? `<img src="${safeUrl(w.featured.thumb)}" alt="" loading="lazy" />` : ''}
      <p class="big" style="font-size:18px"><a href="${safeUrl(w.featured.url)}" target="_blank" rel="noopener">${esc(w.featured.title)}</a></p>
      <p>${esc(w.featured.extract)}</p></article>`);
  }
  if (w?.news?.length) {
    cards.push(`<article class="card card-news"><h3>In the news</h3><ul>${w.news
      .map((n) => `<li><a href="${safeUrl(n.url)}" target="_blank" rel="noopener">${esc(n.text)}</a></li>`)
      .join('')}</ul></article>`);
  }
  if (w?.onthisday?.length) {
    cards.push(`<article class="card card-otd"><h3>On this day</h3><ul>${w.onthisday
      .map((o) => `<li><b>${esc(o.year)}</b><a href="${safeUrl(o.url)}" target="_blank" rel="noopener">${esc(o.text)}</a></li>`)
      .join('')}</ul></article>`);
  }
  const grid = document.getElementById('knowledgeGrid');
  grid.innerHTML = cards.join('') || '<div class="empty">Knowledge cards load after the first data refresh.</div>';
  grid.querySelectorAll('[data-review]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const c = concepts[conceptIdx % concepts.length];
      const added =
        btn.dataset.review === 'concept'
          ? addReviewCard({ front: `What is ${c.term}?`, back: c.extract, source: c.url })
          : addReviewCard({ front: `${t.id} ${t.name}: what is it and how would you detect it?`, back: `${t.description} ${t.detection ? 'Detection: ' + t.detection : ''}`, source: t.url });
      btn.textContent = added ? 'Added to review' : 'Already in review';
      btn.disabled = true;
    }),
  );
  grid.querySelector('#nextConcept')?.addEventListener('click', () => {
    conceptIdx++;
    renderKnowledge(data);
  });
}

// ---------- chess puzzle ----------
const PIECES = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

function boardHTML(fen, lastMove) {
  const [placement, turn] = fen.split(' ');
  const grid = placement.split('/').map((row) => row.replace(/\d/g, (d) => '.'.repeat(Number(d))).split(''));
  const flip = turn === 'b'; // show the board from the solver's side
  const marked = lastMove ? [lastMove.slice(0, 2), lastMove.slice(2, 4)] : [];
  let html = '';
  for (let ri = 0; ri < 8; ri++) {
    for (let fi = 0; fi < 8; fi++) {
      const r = flip ? 7 - ri : ri;
      const f = flip ? 7 - fi : fi;
      const sq = 'abcdefgh'[f] + (8 - r);
      const ch = grid[r]?.[f] || '.';
      // \uFE0E keeps the pawn glyph from rendering as an emoji.
      const piece = ch === '.' ? '' : `<span class="pc ${ch === ch.toUpperCase() ? 'w' : 'b'}">${PIECES[ch.toLowerCase()]}\uFE0E</span>`;
      html += `<div class="sq ${(r + f) % 2 === 0 ? 'l' : 'd'}${marked.includes(sq) ? ' hl' : ''}">${piece}</div>`;
    }
  }
  return `<div class="board" role="img" aria-label="Puzzle position, ${turn === 'w' ? 'white' : 'black'} to move">${html}</div>`;
}

const uciText = (m) => `${m.slice(0, 2)}→${m.slice(2, 4)}${m[4] ? '=' + m[4].toUpperCase() : ''}`;

function renderPuzzle(pane) {
  const el = document.getElementById('pane-chess_puzzle');
  const lp = pane.lichess;
  const cc = pane.chesscom;
  const toMove = lp ? (lp.fen.split(' ')[1] === 'w' ? 'White' : 'Black') : '';
  const solution = lp
    ? lp.solution.map((m, i) => (i % 2 === 0 ? `<b>${esc(uciText(m))}</b>` : esc(uciText(m)))).join(', ')
    : '';
  el.innerHTML = `
    <header class="pane-head">${paneIcon('chess_puzzle')}<h3>Daily puzzle</h3><span class="pane-meta">${esc(ago(pane.updatedAt))}</span></header>
    <div class="puzzle-body">
      ${
        lp
          ? `${boardHTML(lp.fen, lp.lastMove)}
        <div class="puzzle-meta"><span>${toMove} to move</span><span class="badge hot">${esc(lp.rating)}</span>${lp.themes
              .slice(0, 4)
              .map((t) => `<span class="badge">${esc(t.replace(/([A-Z])/g, ' $1').toLowerCase())}</span>`)
              .join('')}</div>
        <div class="puzzle-actions">
          <a href="${safeUrl(lp.url)}" target="_blank" rel="noopener"><i class="ph ph-play" aria-hidden="true"></i>Solve on Lichess</a>
          <details><summary>Show solution</summary><div class="solution">${solution}</div></details>
        </div>`
          : ''
      }
      ${cc ? `<div class="daily-other"><a href="${safeUrl(cc.url)}" target="_blank" rel="noopener">Chess.com daily: ${esc(cc.title)}</a><span>Second puzzle for today</span></div>` : ''}
    </div>`;
}

// ---------- pages ----------
// Each section is its own page, switched by the URL hash (#today, #news, ...).
const PAGES = [...document.querySelectorAll('section.page')].map((s) => s.id);
let currentPage = null;

function showPage(id, { scroll = true } = {}) {
  if (!PAGES.includes(id)) id = 'today';
  const focusOn = document.body.classList.contains('focus');
  if (focusOn && document.getElementById(id).classList.contains('feed-group')) id = 'today';
  currentPage = id;
  for (const sec of document.querySelectorAll('section.page')) sec.hidden = sec.id !== id;
  document.querySelectorAll('.jump a').forEach((a) => {
    if (a.hash === `#${id}`) {
      a.setAttribute('aria-current', 'page');
      a.scrollIntoView({ block: 'nearest', inline: 'center' }); // keeps the tab in view in the phone tab row
    }
    else a.removeAttribute('aria-current');
  });
  const label = document.querySelector(`.jump a[href="#${id}"]`)?.textContent.trim() || 'Today';
  document.title = `${label} · knowbase`;
  store.set('kb.page', id);
  if (scroll) window.scrollTo({ top: 0, behavior: 'instant' });
  const sec = document.getElementById(id);
  scrollers.forEach((s) => sec.contains(s.el) && s.refit());
  if (!reduceMotion.matches) {
    sec.classList.remove('entering');
    void sec.offsetWidth; // restart the animation
    sec.classList.add('entering');
    setTimeout(() => sec.classList.remove('entering'), 900);
  }
  if (id === 'local') showMap();
  if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
}

addEventListener('hashchange', () => showPage(location.hash.slice(1)));
// Turning Focus on while reading a feed page sends you back to Today.
document.getElementById('focusToggle').addEventListener('click', () => showPage(currentPage, { scroll: false }));
let resizeTimer = null;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const sec = document.getElementById(currentPage);
    scrollers.forEach((s) => sec?.contains(s.el) && s.refit());
  }, 250);
});

// ---------- boot ----------
function mountPanes(panes) {
  document.querySelectorAll('[data-panes]').forEach((grid) => {
    for (const id of grid.dataset.panes.split(' ')) {
      if (document.getElementById(`pane-${id}`)) continue;
      const el = paneShell(id, panes?.[id]?.title || id);
      grid.appendChild(el);
      scrollers.set(id, new AutoScroller(id, el));
    }
  });
}

let current = null;
async function load() {
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (current && current.generatedAt === data.generatedAt) return;
    current = data;
    mountPanes(data.panes);
    for (const pane of Object.values(data.panes)) {
      if (!pane) continue;
      if (pane.id === 'la_events') renderEvents(pane);
      else if (pane.id === 'chess_puzzle') renderPuzzle(pane);
      else if (scrollers.has(pane.id)) renderPane(pane);
    }
    renderStrip(data);
    renderKnowledge(data);
    renderToday();
  } catch (err) {
    document.getElementById('freshness').textContent = 'data unavailable, retrying';
    console.error('knowbase: load failed', err);
  }
}

function refreshAges() {
  document.querySelectorAll('.pane-meta[data-updated]').forEach((m) => {
    if (m.dataset.updated) m.textContent = m.textContent.replace(/·.*$/, `· ${ago(m.dataset.updated)}`);
  });
  document.querySelectorAll('time[datetime]').forEach((t) => {
    const v = t.getAttribute('datetime');
    if (v) t.textContent = t.dataset.up ? until(v) : ago(v);
  });
  renderFreshness(current);
}

const themeBtn = document.getElementById('themeToggle');
const isDark = () =>
  document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
// The button names the theme you would switch to.
function syncThemeBtn() {
  themeBtn.innerHTML = isDark()
    ? '<i class="ph ph-sun" aria-hidden="true"></i><span>Light</span>'
    : '<i class="ph ph-moon" aria-hidden="true"></i><span>Dark</span>';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeBtn);
themeBtn.addEventListener('click', () => {
  document.documentElement.dataset.theme = isDark() ? 'light' : 'dark';
  syncThemeBtn();
  try {
    localStorage.setItem('kb.theme', document.documentElement.dataset.theme);
  } catch {}
});

syncPauseAll();
syncThemeBtn();
initToday(() => current);
mountPanes();
showPage(location.hash.slice(1) || store.get('kb.page', 'today'), { scroll: false });
renderEventsShell();
renderClocks();
renderWeather();
load();
requestAnimationFrame(loop);
setInterval(renderClocks, 15000);
setInterval(renderWeather, 15 * 60 * 1000);
setInterval(load, POLL_MS);
setInterval(refreshAges, 30000);
document.addEventListener('visibilitychange', () => !document.hidden && load());

// Handle for poking at state from devtools.
window.knowbase = { scrollers, get data() { return current; } };
