// The Today section: daily 1% challenges, habits, evening journal, reading tracker,
// spaced-repetition review cards and the weekly review. State lives in localStorage
// (kb.growth) and, when sync is set up, in an encrypted gist (see sync.js).
import { esc, safeUrl, store } from './util.js';
import * as sync from './sync.js';

let growthData = null;
let getFeed = () => null;
const grid = () => document.getElementById('todayGrid');

// ---------- dates ----------
const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayNumber = (ymd) => Math.floor(Date.parse(ymd + 'T00:00:00Z') / 864e5);
const shiftDay = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const fmtDay = (ymd, opts = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
const mondayOf = (ymd) => shiftDay(ymd, -((new Date(ymd + 'T12:00:00Z').getUTCDay() + 6) % 7));
const agoShort = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
};

// ---------- state ----------
// Every record carries t (last-modified ms) so two devices can merge entry by entry.
function blankState() {
  return { v: 2, start: localDay(), days: {}, habits: null, journal: {}, reviews: {}, reading: { current: null, finished: {} }, cards: {} };
}
function migrate(s) {
  const st = Object.assign(blankState(), s || {});
  if (Array.isArray(st.habits)) st.habits = { list: st.habits, t: 0 };
  for (const d of Object.values(st.days)) {
    d.ch ??= [];
    d.habits ??= [];
    d.t ??= 0;
  }
  st.reading = { current: null, finished: {}, ...(st.reading || {}) };
  st.v = 2;
  return st;
}
let G = migrate(store.get('kb.growth'));

const newer = (a, b) => (!a ? b : !b ? a : (b.t || 0) > (a.t || 0) ? b : a);
function mergeMap(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = newer(a[k], v);
  return out;
}
function mergeState(local, remote) {
  const L = migrate(local);
  const R = migrate(remote);
  return {
    v: 2,
    start: L.start < R.start ? L.start : R.start,
    days: mergeMap(L.days, R.days),
    habits: newer(L.habits, R.habits),
    journal: mergeMap(L.journal, R.journal),
    reviews: mergeMap(L.reviews, R.reviews),
    reading: { current: newer(L.reading.current, R.reading.current), finished: mergeMap(L.reading.finished, R.reading.finished) },
    cards: mergeMap(L.cards, R.cards),
  };
}

const day = (ymd) => (G.days[ymd] ??= { ch: [], habits: [], pages: 0, reviewed: 0, t: 0 });
const touchDay = (ymd) => (day(ymd).t = Date.now());
const habitList = () => G.habits?.list ?? growthData?.habits ?? [];
const currentBook = () => (G.reading.current && !G.reading.current.cleared ? G.reading.current : null);
const doneCount = (ymd) => {
  const r = G.days[ymd];
  return (r ? r.ch.length + r.habits.length : 0) + (G.journal[ymd]?.win ? 1 : 0);
};

function save({ render = true } = {}) {
  store.set('kb.growth', G);
  if (render) renderToday();
  queueSync();
}

// ---------- sync plumbing ----------
let syncTimer = null;
function queueSync(delay = 1500) {
  if (!sync.configured()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, delay);
}
async function runSync() {
  if (!sync.configured()) return renderSyncBtn();
  const before = JSON.stringify(G);
  try {
    const merged = await sync.syncNow(G, mergeState);
    // Merge again so edits made while the request was in flight win.
    G = mergeState(G, merged);
    store.set('kb.growth', G);
    if (JSON.stringify(G) !== before) renderToday();
    if (JSON.stringify(G) !== JSON.stringify(merged)) queueSync();
  } catch (err) {
    console.warn('knowbase sync:', err.message);
  }
  renderSyncBtn();
}

function renderSyncBtn() {
  const btn = document.getElementById('syncBtn');
  if (!btn) return;
  const s = sync.status();
  const [icon, label] = !sync.configured()
    ? ['ph-cloud-slash', 'Sync off']
    : s?.error
      ? ['ph-warning', 'Sync error']
      : ['ph-cloud-check', s?.lastSync ? `Synced ${agoShort(s.lastSync)}` : 'Syncing'];
  btn.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i><span>${label}</span>`;
  btn.classList.toggle('warn', !!s?.error);
  btn.title = s?.error || 'Sync habits, journal, reading and review cards across devices';
}

function openSyncDialog() {
  const dlg = document.getElementById('syncDialog');
  const on = sync.configured();
  dlg.querySelector('[data-when="off"]').hidden = on;
  dlg.querySelector('[data-when="on"]').hidden = !on;
  dlg.querySelector('.sync-msg').textContent = sync.status()?.error || '';
  dlg.showModal();
}

function wireSyncDialog() {
  const dlg = document.getElementById('syncDialog');
  const msg = dlg.querySelector('.sync-msg');
  dlg.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const token = String(f.get('token') || '');
    const pass = String(f.get('pass') || '');
    if (!token || pass.length < 8) {
      msg.textContent = 'Enter the token and a passphrase of at least 8 characters.';
      return;
    }
    msg.textContent = 'Connecting…';
    try {
      G = migrate(await sync.connect(token, pass, G, mergeState));
      store.set('kb.growth', G);
      e.target.reset();
      msg.textContent = '';
      dlg.close();
      renderToday();
    } catch (err) {
      msg.textContent = err.message;
    }
    renderSyncBtn();
  });
  dlg.querySelector('[data-act="sync-now"]').addEventListener('click', async () => {
    msg.textContent = 'Syncing…';
    await runSync();
    msg.textContent = sync.status()?.error || 'Up to date.';
  });
  dlg.querySelector('[data-act="sync-off"]').addEventListener('click', () => {
    sync.disconnect();
    msg.textContent = 'Sync is off on this device. Your data here and in the gist is untouched.';
    dlg.querySelector('[data-when="off"]').hidden = false;
    dlg.querySelector('[data-when="on"]').hidden = true;
    renderSyncBtn();
  });
  dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
  document.getElementById('syncBtn').addEventListener('click', openSyncDialog);
}

// ---------- challenges ----------
const CAT_ORDER = ['Mind', 'Body', 'Presence', 'Focus', 'Care', 'Character'];
function todaysChallenges(ymd) {
  const n = dayNumber(ymd);
  return [0, 2, 4].map((k) => {
    const list = growthData.challenges.filter((c) => c.cat === CAT_ORDER[(n + k) % CAT_ORDER.length]);
    return list[(n + k * 3) % list.length];
  });
}
function streak(today) {
  let d = doneCount(today) ? today : shiftDay(today, -1);
  let n = 0;
  while (doneCount(d)) {
    n++;
    d = shiftDay(d, -1);
  }
  return n;
}

// ---------- review cards (Leitner boxes) ----------
const INTERVALS = [1, 2, 4, 7, 15, 30, 60, 120]; // days until next review, by box
const liveCards = () => Object.entries(G.cards).filter(([, c]) => !c.deleted);
const dueCards = (ymd) =>
  liveCards()
    .filter(([, c]) => c.due <= ymd)
    .sort((a, b) => (a[1].seen || 0) - (b[1].seen || 0));
let revealed = false;

/** Add a card to the deck. Returns false when the same front already exists. */
export function addReviewCard({ front, back, source = '' }) {
  front = String(front).trim();
  if (!front || liveCards().some(([, c]) => c.front === front)) return false;
  const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  G.cards[id] = { front, back: String(back || '').trim(), source, box: 0, due: localDay(), t: Date.now() };
  save();
  return true;
}

function grade(id, ok) {
  const c = G.cards[id];
  const today = localDay();
  if (ok) {
    c.due = shiftDay(today, INTERVALS[Math.min(c.box, INTERVALS.length - 1)]);
    c.box = Math.min(c.box + 1, INTERVALS.length - 1);
  } else {
    c.box = 0;
    c.due = today;
  }
  c.seen = Date.now();
  c.t = Date.now();
  day(today).reviewed = (day(today).reviewed || 0) + 1;
  touchDay(today);
  revealed = false;
  save();
}

// ---------- reading ----------
function logPages(newPage) {
  const b = currentBook();
  if (!b) return;
  const page = Math.max(0, Math.min(Number(newPage) || 0, b.pages || Infinity));
  const delta = page - b.page;
  const today = localDay();
  if (delta > 0) {
    day(today).pages = (day(today).pages || 0) + delta;
    // Reading 10+ pages counts for the default reading habit.
    const habit = habitList().find((h) => /^read 10 pages$/i.test(h));
    if (habit && day(today).pages >= 10 && !day(today).habits.includes(habit)) day(today).habits.push(habit);
    touchDay(today);
  }
  G.reading.current = { ...b, page, t: Date.now() };
  save();
}

// ---------- rendering ----------
let renderedDay = null;
let pendingRender = false;

export function renderToday() {
  if (!growthData) return;
  // Don't wipe out what the user is typing; render once they leave the field.
  const active = document.activeElement;
  if (active && grid().contains(active) && /^(TEXTAREA|INPUT|SELECT)$/.test(active.tagName) && active.type !== 'checkbox') {
    pendingRender = true;
    return;
  }
  pendingRender = false;
  const ymd = localDay();
  renderedDay = ymd;
  grid().innerHTML = [quoteCard(ymd), challengeCard(ymd), habitsCard(ymd), bookCard(ymd), journalCard(ymd), readingCard(ymd), reviewCard(ymd), weekCard(ymd)].join('');
  renderSyncBtn();
}

function quoteCard(ymd) {
  const quote = growthData.quotes[dayNumber(ymd) % growthData.quotes.length];
  const zen = getFeed()?.panes.books?.zen;
  return `<article class="card quote-card">
    <i class="ph ph-quotes" aria-hidden="true"></i>
    <blockquote>${esc(quote.q)}<cite>${esc(quote.a)}</cite></blockquote>
    ${zen ? `<div class="zen">${esc(zen.q)}<cite>${esc(zen.a)} · via ZenQuotes</cite></div>` : ''}
  </article>`;
}

function challengeCard(ymd) {
  const rec = G.days[ymd] || { ch: [] };
  const activeDays = Object.keys({ ...G.days, ...G.journal }).filter(doneCount).length;
  return `<article class="card card-challenge">
    <div class="card-head">
      <h3>Today's 1%</h3>
      <div class="score"><b>${(1.01 ** activeDays).toFixed(2)}×</b> after ${activeDays} active day${activeDays === 1 ? '' : 's'}<br>${streak(ymd)}-day streak</div>
    </div>
    <ul class="checks">${todaysChallenges(ymd)
      .map(
        (c) => `<li><label class="check${rec.ch.includes(c.text) ? ' done' : ''}">
          <input type="checkbox" data-ch="${esc(c.text)}"${rec.ch.includes(c.text) ? ' checked' : ''} />
          <span class="txt">${esc(c.text)}<span class="tag">${esc(c.cat)}${c.from ? ` · inspired by ${esc(c.from)}` : ''}</span></span><span></span>
        </label></li>`,
      )
      .join('')}</ul>
  </article>`;
}

function habitsCard(ymd) {
  const rec = G.days[ymd] || { habits: [] };
  const habits = habitList();
  const cells = [-6, -5, -4, -3, -2, -1, 0]
    .map((off) => {
      const d = shiftDay(ymd, off);
      const f = Math.min(1, doneCount(d) / (4 + habits.length));
      return `<div title="${d}: ${doneCount(d)} done"><span style="--f:${f.toFixed(2)}"></span>${fmtDay(d, { weekday: 'narrow' })}</div>`;
    })
    .join('');
  return `<article class="card card-habits">
    <h3>Daily habits</h3>
    <ul class="checks">${habits
      .map(
        (h, i) => `<li><label class="check${rec.habits.includes(h) ? ' done' : ''}">
          <input type="checkbox" data-habit="${esc(h)}"${rec.habits.includes(h) ? ' checked' : ''} />
          <span class="txt">${esc(h)}</span>
          <button class="rm" type="button" data-act="rm-habit" data-i="${i}" title="Remove habit" aria-label="Remove ${esc(h)}"><i class="ph ph-x"></i></button>
        </label></li>`,
      )
      .join('')}</ul>
    <form class="inline-form" data-form="add-habit"><input name="h" maxlength="60" placeholder="Add a habit" aria-label="New habit" /><button class="pill-btn" type="submit"><i class="ph ph-plus" aria-hidden="true"></i><span>Add</span></button></form>
    <div class="week" aria-label="Last 7 days">${cells}</div>
  </article>`;
}

function bookCard(ymd) {
  const books = getFeed()?.panes.books?.books || [];
  const week = Math.floor(dayNumber(ymd) / 7);
  const book = books[week % (books.length || 1)];
  const upNext = books.length ? [1, 2, 3].map((k) => books[(week + k) % books.length]) : [];
  return `<article class="card card-book">
    <h3>Book of the week</h3>
    ${
      book
        ? `<a class="book" href="${safeUrl(book.url)}" target="_blank" rel="noopener">
        ${coverImg(book)}
        <div><b>${esc(book.title)}</b><span>${esc(book.author)}</span><p>${esc(book.why)}</p></div>
      </a>
      ${currentBook() ? '' : `<button class="pill-btn" type="button" data-act="read-this" data-title="${esc(book.title)}"><i class="ph ph-book-open-text" aria-hidden="true"></i><span>Start reading this</span></button>`}
      <ul class="upnext"><li><b>Up next</b></li>${upNext.map((b) => `<li>${esc(b.title)}, ${esc(b.author)}</li>`).join('')}</ul>`
        : '<p>The reading list loads after the next data refresh.</p>'
    }
  </article>`;
}

const coverImg = (b) =>
  b?.isbn || b?.cover
    ? `<img src="${safeUrl(b.cover || `https://covers.openlibrary.org/b/isbn/${b.isbn}-M.jpg?default=false`)}" alt="Cover of ${esc(b.title)}" loading="lazy" onerror="this.outerHTML='<div class=nocover>No cover</div>'" />`
    : `<div class="nocover">${esc(b?.title || '')}</div>`;

function journalCard(ymd) {
  const j = G.journal[ymd] || {};
  const past = Object.entries(G.journal)
    .filter(([d, e]) => d < ymd && e.win)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, 14);
  const evening = new Date().getHours() >= 18;
  return `<article class="card card-journal${evening && !j.win ? ' nudge-card' : ''}">
    <div class="card-head"><h3>Evening journal</h3><span class="saved" data-saved hidden>Saved</span></div>
    <label class="field">What got 1% better today?
      <textarea data-field="journal.win" rows="3" maxlength="600" placeholder="One line is enough.">${esc(j.win || '')}</textarea>
    </label>
    <label class="field">One thing for tomorrow
      <input data-field="journal.next" maxlength="200" value="${esc(j.next || '')}" />
    </label>
    ${
      past.length
        ? `<details class="past"><summary>Past entries (${past.length})</summary><ul>${past
            .map(([d, e]) => `<li><b>${esc(fmtDay(d))}</b>${esc(e.win)}${e.next ? `<span>Next: ${esc(e.next)}</span>` : ''}</li>`)
            .join('')}</ul></details>`
        : ''
    }
  </article>`;
}

function readingCard(ymd) {
  const b = currentBook();
  const finished = Object.values(G.reading.finished).filter((f) => !f.deleted).sort((a, c) => (a.done < c.done ? 1 : -1));
  const finishedHTML = finished.length
    ? `<details class="past"><summary>Finished (${finished.length})</summary><ul>${finished
        .map((f) => `<li><b>${esc(fmtDay(f.done, { month: 'short', day: 'numeric', year: 'numeric' }))}</b>${esc(f.title)}${f.author ? `, ${esc(f.author)}` : ''}</li>`)
        .join('')}</ul></details>`
    : '';
  if (!b) {
    const books = getFeed()?.panes.books?.books || [];
    return `<article class="card card-reading">
      <h3>Currently reading</h3>
      <form class="stack-form" data-form="read-start">
        <label class="field">Pick from the reading list
          <select name="pick"><option value="">Choose a book…</option>${books.map((x) => `<option>${esc(x.title)}</option>`).join('')}</select>
        </label>
        <label class="field">or type any title <input name="title" maxlength="120" placeholder="Title" /></label>
        <label class="field">Total pages <input name="pages" type="number" min="1" max="5000" inputmode="numeric" placeholder="e.g. 320" /></label>
        <button class="pill-btn" type="submit"><i class="ph ph-book-open-text" aria-hidden="true"></i><span>Start</span></button>
      </form>
      ${finishedHTML}
    </article>`;
  }
  const pct = b.pages ? Math.round((b.page / b.pages) * 100) : 0;
  const today = G.days[ymd]?.pages || 0;
  return `<article class="card card-reading">
    <h3>Currently reading</h3>
    <div class="reading">
      ${coverImg(b)}
      <div>
        <b>${esc(b.title)}</b>${b.author ? `<span class="by">${esc(b.author)}</span>` : ''}
        <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
        <span class="by">Page ${b.page} of ${b.pages || '?'} · ${pct}% · ${today} today</span>
      </div>
    </div>
    <form class="inline-form" data-form="read-update">
      <input name="page" type="number" min="0" max="${b.pages || 99999}" inputmode="numeric" placeholder="Page you're on" aria-label="Current page" />
      <button class="pill-btn" type="submit"><span>Update</span></button>
      <button class="pill-btn" type="button" data-act="read-add10"><span>+10</span></button>
    </form>
    <div class="row-actions">
      <button class="link-btn" type="button" data-act="read-finish">Mark finished</button>
      <button class="link-btn" type="button" data-act="read-clear">Switch book</button>
    </div>
    ${finishedHTML}
  </article>`;
}

function reviewCard(ymd) {
  const due = dueCards(ymd);
  const all = liveCards();
  const next = all.map(([, c]) => c.due).filter((d) => d > ymd).sort()[0];
  let body;
  if (due.length) {
    const [id, c] = due[0];
    body = `<div class="flash">
      <p class="front">${esc(c.front)}</p>
      ${
        revealed
          ? `<p class="back">${esc(c.back || '(no answer written)')}</p>
        <div class="row-actions"><button class="pill-btn" type="button" data-act="card-again" data-id="${esc(id)}"><span>Again</span></button><button class="pill-btn primary" type="button" data-act="card-good" data-id="${esc(id)}"><span>Got it</span></button></div>`
          : `<button class="pill-btn" type="button" data-act="card-show"><span>Show answer</span></button>`
      }
    </div>`;
  } else {
    body = `<p class="muted">${all.length ? `Nothing due. ${all.length} card${all.length === 1 ? '' : 's'} in the deck${next ? `, next one ${esc(fmtDay(next))}` : ''}.` : 'No cards yet. Add one below, or use "Add to review" on the concept and ATT&CK cards.'}</p>`;
  }
  return `<article class="card card-cards">
    <div class="card-head"><h3>Review</h3><span class="score">${due.length} due</span></div>
    ${body}
    <form class="stack-form" data-form="card-add">
      <input name="front" maxlength="300" placeholder="Question or term" aria-label="Card front" />
      <input name="back" maxlength="1000" placeholder="Answer" aria-label="Card back" />
      <button class="pill-btn" type="submit"><i class="ph ph-plus" aria-hidden="true"></i><span>Add card</span></button>
    </form>
    ${
      all.length
        ? `<details class="past"><summary>All cards (${all.length})</summary><ul>${all
            .map(([id, c]) => `<li class="card-row"><span>${esc(c.front)}<span>box ${c.box + 1} · due ${esc(fmtDay(c.due, { month: 'short', day: 'numeric' }))}</span></span><button class="rm" type="button" data-act="card-del" data-id="${esc(id)}" aria-label="Delete card"><i class="ph ph-x"></i></button></li>`)
            .join('')}</ul></details>`
        : ''
    }
  </article>`;
}

function weekCard(ymd) {
  const mon = mondayOf(ymd);
  const days = [];
  for (let d = mon; d <= ymd; d = shiftDay(d, 1)) days.push(d);
  const sum = (fn) => days.reduce((n, d) => n + fn(G.days[d] || {}, d), 0);
  const habitsN = habitList().length;
  const habitPct = habitsN ? Math.round((sum((r) => (r.habits || []).length) / (habitsN * days.length)) * 100) : 0;
  const stats = [
    ['Challenges', `${sum((r) => (r.ch || []).length)}/${days.length * 3}`],
    ['Habits', `${habitPct}%`],
    ['Journal', `${days.filter((d) => G.journal[d]?.win).length}/${days.length}`],
    ['Pages', sum((r) => r.pages || 0)],
    ['Cards reviewed', sum((r) => r.reviewed || 0)],
  ];
  const rv = G.reviews[mon] || {};
  const weekend = [0, 5, 6].includes(new Date().getDay());
  const pastReviews = Object.entries(G.reviews)
    .filter(([w, r]) => w < mon && (r.best || r.slow || r.change))
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, 8);
  return `<article class="card card-week">
    <div class="card-head"><h3>This week (from ${esc(fmtDay(mon, { month: 'short', day: 'numeric' }))})</h3><span class="saved" data-saved hidden>Saved</span></div>
    <div class="stats">${stats.map(([k, v]) => `<div><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>
    <details class="review-form"${weekend || rv.best ? ' open' : ''}>
      <summary>Weekly review</summary>
      <div class="review-fields">
        <label class="field">Best win this week<textarea data-field="review.best" rows="2" maxlength="500">${esc(rv.best || '')}</textarea></label>
        <label class="field">What slowed you down<textarea data-field="review.slow" rows="2" maxlength="500">${esc(rv.slow || '')}</textarea></label>
        <label class="field">One change for next week<textarea data-field="review.change" rows="2" maxlength="500">${esc(rv.change || '')}</textarea></label>
      </div>
    </details>
    ${
      pastReviews.length
        ? `<details class="past"><summary>Past reviews (${pastReviews.length})</summary><ul>${pastReviews
            .map(([w, r]) => `<li><b>Week of ${esc(fmtDay(w, { month: 'short', day: 'numeric' }))}</b>${esc(r.best || '')}${r.change ? `<span>Change: ${esc(r.change)}</span>` : ''}</li>`)
            .join('')}</ul></details>`
        : ''
    }
  </article>`;
}

// ---------- events ----------
let fieldTimer = null;
function onField(el) {
  const [kind, key] = el.dataset.field.split('.');
  const ymd = localDay();
  const target = kind === 'journal' ? (G.journal[ymd] ??= {}) : (G.reviews[mondayOf(ymd)] ??= {});
  target[key] = el.value;
  target.t = Date.now();
  clearTimeout(fieldTimer);
  fieldTimer = setTimeout(() => {
    save({ render: false });
    const flag = el.closest('.card')?.querySelector('[data-saved]');
    if (flag) {
      flag.hidden = false;
      setTimeout(() => (flag.hidden = true), 1500);
    }
  }, 500);
}

function wireEvents() {
  const g = grid();
  g.addEventListener('input', (e) => e.target.dataset.field && onField(e.target));
  g.addEventListener('focusout', () => setTimeout(() => pendingRender && !g.contains(document.activeElement) && renderToday(), 0));
  g.addEventListener('change', (e) => {
    const box = e.target.closest('input[type=checkbox]');
    if (!box) return;
    const ymd = localDay();
    const rec = day(ymd);
    const [key, val] = box.dataset.ch ? ['ch', box.dataset.ch] : ['habits', box.dataset.habit];
    rec[key] = box.checked ? [...new Set([...rec[key], val])] : rec[key].filter((x) => x !== val);
    touchDay(ymd);
    save();
  });
  g.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    e.preventDefault();
    const act = btn.dataset.act;
    if (act === 'rm-habit') {
      G.habits = { list: habitList().filter((_, i) => i !== Number(btn.dataset.i)), t: Date.now() };
      save();
    } else if (act === 'card-show') {
      revealed = true;
      renderToday();
    } else if (act === 'card-good' || act === 'card-again') {
      grade(btn.dataset.id, act === 'card-good');
    } else if (act === 'card-del') {
      G.cards[btn.dataset.id] = { ...G.cards[btn.dataset.id], deleted: true, t: Date.now() };
      save();
    } else if (act === 'read-add10') {
      logPages((currentBook()?.page || 0) + 10);
    } else if (act === 'read-finish') {
      const b = currentBook();
      G.reading.finished[b.title] = { title: b.title, author: b.author || '', done: localDay(), t: Date.now() };
      G.reading.current = { cleared: true, t: Date.now() };
      save();
    } else if (act === 'read-clear') {
      G.reading.current = { cleared: true, t: Date.now() };
      save();
    } else if (act === 'read-this') {
      const sel = g.querySelector('[data-form="read-start"] select');
      if (sel) {
        sel.value = btn.dataset.title;
        g.querySelector('[data-form="read-start"] input[name="pages"]').focus();
      }
    }
  });
  g.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const f = new FormData(form);
    const kind = form.dataset.form;
    if (kind === 'add-habit') {
      const h = String(f.get('h') || '').trim();
      if (h && !habitList().includes(h)) G.habits = { list: [...habitList(), h], t: Date.now() };
    } else if (kind === 'read-start') {
      const books = getFeed()?.panes.books?.books || [];
      const picked = books.find((b) => b.title === f.get('pick'));
      const title = String(f.get('title') || '').trim() || picked?.title;
      if (!title) return;
      const fromList = picked && picked.title === title ? picked : books.find((b) => b.title === title);
      G.reading.current = {
        title,
        author: fromList?.author || '',
        isbn: fromList?.isbn || null,
        pages: Number(f.get('pages')) || null,
        page: 0,
        started: localDay(),
        t: Date.now(),
      };
    } else if (kind === 'read-update') {
      form.querySelector('input').blur();
      return logPages(f.get('page'));
    } else if (kind === 'card-add') {
      addReviewCard({ front: f.get('front'), back: f.get('back') });
      form.querySelector('input').blur();
      return;
    }
    form.querySelector('input')?.blur();
    save();
  });
}

// ---------- time on board + nudge ----------
const NUDGE_MINUTES = 30;
let timeLog = store.get('kb.time', {});
const freshTimeLog = () => ({ day: localDay(), secs: 0, nudged: false });
if (timeLog.day !== localDay()) timeLog = freshTimeLog();

function renderTime() {
  const m = Math.floor(timeLog.secs / 60);
  const el = document.getElementById('timeToday');
  el.textContent = `${m}m today`;
  el.classList.toggle('over', m >= NUDGE_MINUTES);
  if (m >= NUDGE_MINUTES && !timeLog.nudged) {
    const open = growthData ? todaysChallenges(localDay()).filter((c) => !(G.days[localDay()]?.ch || []).includes(c.text)).length : 0;
    const nudge = document.getElementById('nudge');
    nudge.querySelector('p').textContent =
      `${m} minutes here today, and the feeds will still be here tomorrow.` +
      (open ? ` ${open} of today's challenges ${open === 1 ? 'is' : 'are'} still open.` : ' Your challenges are done. Go enjoy the day.');
    nudge.hidden = false;
  }
}

// ---------- focus mode ----------
function applyFocus(on) {
  const btn = document.getElementById('focusToggle');
  document.body.classList.toggle('focus', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.innerHTML = on
    ? '<i class="ph ph-list" aria-hidden="true"></i><span>Show all</span>'
    : '<i class="ph ph-target" aria-hidden="true"></i><span>Focus</span>';
}

// ---------- init ----------
export function initToday(feedAccessor) {
  getFeed = feedAccessor;
  wireEvents();
  wireSyncDialog();
  renderSyncBtn();

  document.getElementById('nudgeClose').addEventListener('click', () => {
    timeLog.nudged = true;
    store.set('kb.time', timeLog);
    document.getElementById('nudge').hidden = true;
  });
  setInterval(() => {
    if (document.hidden) return;
    if (timeLog.day !== localDay()) timeLog = freshTimeLog();
    timeLog.secs += 15;
    store.set('kb.time', timeLog);
    renderTime();
    if (renderedDay && renderedDay !== localDay()) renderToday(); // rolled past midnight
  }, 15000);
  renderTime();

  document.getElementById('focusToggle').addEventListener('click', () => {
    const on = !document.body.classList.contains('focus');
    store.set('kb.focus', on);
    applyFocus(on);
  });
  applyFocus(store.get('kb.focus', false));

  fetch('growth.json')
    .then((r) => r.json())
    .then((j) => {
      growthData = j;
      renderToday();
    })
    .catch((err) => console.error('knowbase: growth.json failed', err));

  // Pull other devices' changes when coming back to the tab, and every few minutes.
  runSync();
  document.addEventListener('visibilitychange', () => !document.hidden && queueSync(0));
  setInterval(() => !document.hidden && queueSync(0), 3 * 60 * 1000);
  setInterval(renderSyncBtn, 30000);
}
