'use strict';

const app = document.getElementById('app');

const state = {
  event: null,
  me: null,
  token: null,
  mySlots: new Set(),
  openDate: null,
  pollTimer: null,
};

let paint = null; // active drag-paint: { target: boolean, changed: boolean }
let copyDrag = null; // hours-mode day drag: { source, pattern, active, changed, count }

// ---------- utils ----------

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = s => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const timeLabel = min => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const niceDate = (s, opts) =>
  parseDate(s).toLocaleDateString('en-GB', opts || { weekday: 'short', day: 'numeric', month: 'short' });

function daySlots(ev, date) {
  if (ev.mode === 'days') return [date];
  const out = [];
  for (let m = ev.startHour * 60; m < ev.endHour * 60; m += ev.slotMinutes) {
    out.push(`${date}T${timeLabel(m)}`);
  }
  return out;
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

const MOUNTAIN_SVG = `<svg class="mark" viewBox="0 0 24 14" aria-hidden="true">
  <path d="M1 13 L8 3 L11 7.5 L15 1 L23 13 Z"/></svg>`;

const DOOR_SVG = `<svg class="hero-door" viewBox="0 0 96 96" aria-hidden="true">
  <defs><clipPath id="doorclip"><circle cx="48" cy="48" r="34"/></clipPath></defs>
  <circle class="frame-outer" cx="48" cy="48" r="43"/>
  <circle class="frame" cx="48" cy="48" r="37.5"/>
  <circle class="panel" cx="48" cy="48" r="34"/>
  <g clip-path="url(#doorclip)">
    <g class="planks">
      <line x1="27" y1="10" x2="27" y2="86"/>
      <line x1="41" y1="10" x2="41" y2="86"/>
      <line x1="55" y1="10" x2="55" y2="86"/>
      <line x1="69" y1="10" x2="69" y2="86"/>
    </g>
    <circle class="sheen" cx="36" cy="34" r="30"/>
  </g>
  <circle class="knob" cx="48" cy="48" r="5"/></svg>`;

const LOCK_SVG = `<svg class="lock" viewBox="0 0 12 14" aria-hidden="true">
  <rect x="1.5" y="6" width="9" height="7" rx="1.5"/>
  <path d="M3.5 6 V4 a2.5 2.5 0 0 1 5 0 V6" fill="none"/></svg>`;

const themeToggleHtml = () =>
  `<button class="ghost" data-theme-toggle>${
    document.documentElement.dataset.theme === 'dark' ? 'Daylight' : 'Evening'
  }</button>`;

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ---------- routing ----------

function route() {
  clearInterval(state.pollTimer);
  state.event = state.me = state.openDate = null;
  state.mySlots = new Set();
  const legacy = location.hash.match(/^#e\/([\w-]+)/);
  if (legacy) {
    location.replace(`/e/${legacy[1]}`);
    return;
  }
  const m = location.pathname.match(/^\/e\/([\w-]+)/);
  if (m) enterEvent(m[1]);
  else renderCreate();
}

const QUOTES = [
  'The road goes ever on and on.',
  'No admittance except on party business.',
  'It does not do to leave a live dragon out of your calculations.',
  "I'm going on an adventure!",
  'A little food, a little cheer, and a date that suits us all.',
];
const colophonHtml = () =>
  `<footer class="colophon">${QUOTES[Math.floor(Math.random() * QUOTES.length)]}</footer>`;

// ---------- create page ----------

function renderCreate() {
  const today = new Date();
  const in13 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 13);
  const hourOpts = (from, to, sel) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i)
      .map(h => `<option value="${h}" ${h === sel ? 'selected' : ''}>${timeLabel(h * 60)}</option>`)
      .join('');

  app.innerHTML = `
  <div class="page">
    <header class="topbar solo">${themeToggleHtml()}</header>
    <div class="create-col">
    <header class="hero">
      ${DOOR_SVG}
      <h1>Sign To Erebor</h1>
      <p class="tagline">Gather your company. Find the day the quest begins.</p>
    </header>
    <div class="fancy-rule">❦</div>
    <form id="create-form" class="card">
      <label>Quest name
        <input name="name" required maxlength="100" placeholder="e.g. Council at Bag End" autocomplete="off">
      </label>
      <div class="row">
        <label>First day <input type="date" name="startDate" required value="${fmtDate(today)}"></label>
        <label>Last day <input type="date" name="endDate" required value="${fmtDate(in13)}"></label>
      </div>
      <fieldset>
        <legend>What do people pick?</legend>
        <label class="radio"><input type="radio" name="mode" value="hours" checked>
          <span><b>Days &amp; hours</b> — click a day on the calendar to choose hours within it</span></label>
        <label class="radio"><input type="radio" name="mode" value="days">
          <span><b>Days only</b> — just mark whole days, no hour picking</span></label>
      </fieldset>
      <div class="row hours-only">
        <label>Earliest <select name="startHour">${hourOpts(0, 23, 9)}</select></label>
        <label>Latest <select name="endHour">${hourOpts(1, 24, 18)}</select></label>
        <label>Slot length <select name="slotMinutes">
          <option value="60" selected>1 hour</option>
          <option value="30">30 min</option>
        </select></label>
      </div>
      <button type="submit" class="primary">Forge the sign-up sheet</button>
      <p class="hint">You'll get a link to share with your company. Up to 92 days per quest.</p>
    </form>
    </div>
    <details class="guide" id="guide">
      <summary>What is this place?</summary>
      <div class="guide-body">
        <p>Sign To Erebor finds the day — and the hour — when your whole company can meet.
           One of you forges a quest; everyone else opens the shared link and paints the
           times that suit them. The greener a day glows, the more of you can come.
           When the last day of a plan has passed, the plan quietly dissolves.</p>
        <ol class="steps">
          <li>
            <h3>1 · Forge the quest</h3>
            <p>Give it a name, choose the first and last day, and decide whether companions
               pick whole days or hours within each day.</p>
            <img class="only-light" src="/img/guide-forge.png" alt="The quest creation form" loading="lazy">
            <img class="only-dark" src="/img/guide-forge-dark.png" alt="The quest creation form" loading="lazy">
          </li>
          <li>
            <h3>2 · Rally the company</h3>
            <p>Copy the invite link and send it round. Each companion signs the contract
               with their name — a password is optional, but keeps others from editing
               your marks.</p>
            <img class="only-light" src="/img/guide-sign.png" alt="Signing the contract with your name" loading="lazy">
            <img class="only-dark" src="/img/guide-sign-dark.png" alt="Signing the contract with your name" loading="lazy">
          </li>
          <li>
            <h3>3 · Paint your availability</h3>
            <p>Click or drag across calendar days. In hours mode, click a day to paint the
               hours that suit you — or drag one painted day across others to copy its
               hours onto them.</p>
            <img class="only-light" src="/img/guide-paint.png" alt="Picking hours within a single day" loading="lazy">
            <img class="only-dark" src="/img/guide-paint-dark.png" alt="Picking hours within a single day" loading="lazy">
          </li>
          <li>
            <h3>4 · Read the map</h3>
            <p>Green shows when the company can gather, and the sidebar ranks the finest
               times. Meet at the greenest hour.</p>
            <img class="only-light" src="/img/guide-best.png" alt="The best times ranked in the sidebar" loading="lazy">
            <img class="only-dark" src="/img/guide-best-dark.png" alt="The best times ranked in the sidebar" loading="lazy">
          </li>
        </ol>
      </div>
    </details>
    ${colophonHtml()}
  </div>`;

  const form = document.getElementById('create-form');
  const syncMode = () => {
    const hours = form.elements.mode.value === 'hours';
    form.querySelector('.hours-only').style.display = hours ? '' : 'none';
  };
  form.addEventListener('change', syncMode);
  syncMode();

  if (location.hash === '#guide') {
    const guide = document.getElementById('guide');
    if (guide) {
      guide.open = true;
      guide.scrollIntoView({ behavior: 'smooth' });
    }
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = form.elements;
    try {
      const ev = await api('POST', '/api/events', {
        name: f.name.value,
        mode: f.mode.value,
        startDate: f.startDate.value,
        endDate: f.endDate.value,
        startHour: Number(f.startHour.value),
        endHour: Number(f.endHour.value),
        slotMinutes: Number(f.slotMinutes.value),
      });
      location.href = `/e/${ev.id}`;
    } catch (err) {
      toast(err.message);
    }
  });
}

// ---------- event page ----------

async function enterEvent(id) {
  app.innerHTML = '<div class="page"><p class="loading">Consulting the maps…</p></div>';
  try {
    await refreshEvent(id);
  } catch (err) {
    app.innerHTML = `
    <div class="page narrow">
      <header class="hero">${DOOR_SVG}<h1>Sign To Erebor</h1></header>
      <div class="card lost">
        <span class="lost-mark">${MOUNTAIN_SVG}</span>
        <h2>The dragon has claimed this plan</h2>
        <p class="hint">${esc(err.message)}. Plans dissolve once their last day has passed —
          this one may have run its course.</p>
        <p><a href="/">← Forge a new quest</a></p>
      </div>
      ${colophonHtml()}
    </div>`;
    return;
  }
  state.pollTimer = setInterval(() => {
    if (!paint && !document.hidden && state.event) refreshEvent(id).catch(() => {});
  }, 10000);
  const day = new URLSearchParams(location.search).get('day');
  if (day && state.event?.mode === 'hours' && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    state.openDate = day;
    renderEvent();
  }
}

async function refreshEvent(id) {
  const ev = await api('GET', `/api/events/${id}`);
  state.event = ev;
  const pid = localStorage.getItem(`ste-pid-${id}`);
  state.token = localStorage.getItem(`ste-token-${id}`);
  state.me = state.token ? ev.participants.find(p => p.id === pid) || null : null;
  if (pid && !state.me) {
    localStorage.removeItem(`ste-pid-${id}`);
    localStorage.removeItem(`ste-token-${id}`);
    state.token = null;
  }
  state.mySlots = new Set(state.me ? state.me.slots : []);
  renderEvent();
  const ready = ev.participants.length >= 2 && ev.participants.every(p => p.slots.length > 0);
  if (ready && !sessionStorage.getItem(`ste-fw-${id}`)) {
    sessionStorage.setItem(`ste-fw-${id}`, '1');
    launchFireworks();
  }
}

// availability aggregations: key -> [names]
function countMap(keyFn) {
  const map = new Map();
  for (const p of state.event.participants) {
    for (const key of new Set(p.slots.map(keyFn))) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p.name);
    }
  }
  return map;
}
const dayCounts = () => countMap(s => s.slice(0, 10));
const slotCounts = () => countMap(s => s);

function renderEvent() {
  const ev = state.event;
  const hoursChip = ev.mode === 'hours'
    ? `${timeLabel(ev.startHour * 60)}–${timeLabel(ev.endHour * 60)} each day`
    : 'whole days';

  app.innerHTML = `
  <div class="page">
    <header class="topbar">
      <a class="brand" href="/">${MOUNTAIN_SVG} Sign To Erebor</a>
      <span class="topbar-actions">
        <a class="ghost" href="/#guide">What is this?</a>
        ${themeToggleHtml()}
        <button class="ghost" data-copy>Copy invite link</button>
      </span>
    </header>
    <section class="card event-card">
      <h1>${esc(ev.name)}</h1>
      <div class="chips">
        <span class="chip">${niceDate(ev.startDate)} → ${niceDate(ev.endDate)}</span>
        <span class="chip">${hoursChip}</span>
        <span class="chip">${ev.participants.length} ${ev.participants.length === 1 ? 'companion' : 'companions'}</span>
        <span class="chip">dissolves after ${niceDate(ev.endDate)}</span>
      </div>
      <div class="identity" id="join-card">${joinHtml()}</div>
    </section>
    <div class="layout">
      <section class="calendar">${journeyHtml()}${calendarHtml()}</section>
      <aside class="side">
        <div class="card">
          <h3>Legend</h3>
          <div class="legend-bar"></div>
          <div class="legend-scale"><span>no one</span><span>everyone</span></div>
          <p class="hint">${ev.mode === 'hours'
              ? 'Click a day to pick your hours. Drag from a day across other days to copy its hours onto them.'
              : 'Click or drag across days to mark when you can come.'}
            A gold ring marks your own picks.</p>
        </div>
        <div class="card"><h3>Best ${ev.mode === 'hours' ? 'times' : 'days'}</h3>${bestHtml()}</div>
        <div class="card"><h3>The company</h3>${companyHtml()}</div>
      </aside>
    </div>
    ${colophonHtml()}
  </div>
  ${state.openDate ? modalHtml(state.openDate) : ''}`;

  const joinForm = document.getElementById('join-form');
  if (joinForm) {
    joinForm.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const p = await api('POST', `/api/events/${ev.id}/join`, {
          name: joinForm.elements.name.value,
          password: joinForm.elements.password.value,
        });
        localStorage.setItem(`ste-pid-${ev.id}`, p.id);
        localStorage.setItem(`ste-token-${ev.id}`, p.token);
        await refreshEvent(ev.id);
      } catch (err) {
        toast(err.message);
      }
    });
  }
}

// "there and back again": company readiness as a journey from the Shire to Erebor
function journeyHtml() {
  const ev = state.event;
  const total = ev.participants.length;
  const done = ev.participants.filter(p => p.slots.length > 0).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const label = total
    ? `${done} of ${total} companions have marked their days${pct === 100 ? ' — the company is ready' : ''}`
    : 'The company gathers — share the invite link';
  return `
  <div class="journey" style="--p:${pct}%" title="${esc(label)}">
    <span class="j-end j-door">${DOOR_SVG}</span>
    <div class="j-track"><span class="j-walker"></span></div>
    <span class="j-end j-peak">${MOUNTAIN_SVG}</span>
    <span class="j-label">${label}</span>
  </div>`;
}

function launchFireworks() {
  const wrap = document.createElement('div');
  wrap.className = 'fireworks';
  const colors = ['#d9a94a', '#7fa85e', '#c0563a', '#e6dfc9'];
  for (let burst = 0; burst < 3; burst++) {
    const cx = 15 + Math.random() * 70;
    const cy = 15 + Math.random() * 35;
    for (let i = 0; i < 26; i++) {
      const p = document.createElement('span');
      const ang = Math.random() * 2 * Math.PI;
      const dist = 50 + Math.random() * 90;
      p.style.left = `${cx}vw`;
      p.style.top = `${cy}vh`;
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(ang) * dist + 40}px`);
      p.style.animationDelay = `${burst * 0.4 + Math.random() * 0.15}s`;
      wrap.appendChild(p);
    }
  }
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 3500);
}

function joinHtml() {
  if (state.me) {
    return `<p>Signing as <b>${esc(state.me.name)}</b>
      <button class="link" data-leave>not you?</button></p>`;
  }
  return `
  <form id="join-form" class="row join-row">
    <input name="name" required maxlength="50" placeholder="Your name" autocomplete="off">
    <input name="password" type="password" maxlength="100" placeholder="Password (optional)" autocomplete="off">
    <button type="submit" class="primary"
      title="Terms: cash on delivery, up to but not exceeding one fourteenth of total profits, if any.">
      Sign the contract</button>
  </form>
  <p class="hint">Signing lets you mark your availability. A password protects your name —
    without one, anyone entering your name can edit your hours.
    Returning? Enter the same name (and password).</p>`;
}

function calendarHtml() {
  const ev = state.event;
  const start = parseDate(ev.startDate);
  const end = parseDate(ev.endDate);
  let html = '';
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    html += monthHtml(cur, start, end);
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return html;
}

function monthHtml(monthStart, rangeStart, rangeEnd) {
  const ev = state.event;
  const counts = dayCounts();
  const total = ev.participants.length;
  const y = monthStart.getFullYear();
  const mo = monthStart.getMonth();
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const lead = (new Date(y, mo, 1).getDay() + 6) % 7; // Monday-first

  let cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    .map(w => `<div class="wd">${w}</div>`).join('');
  cells += '<div class="day pad"></div>'.repeat(lead);

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(y, mo, d);
    const key = fmtDate(date);
    if (date < rangeStart || date > rangeEnd) {
      cells += `<div class="day off"><span class="num">${d}</span></div>`;
      continue;
    }
    const names = counts.get(key) || [];
    const heat = total ? names.length / total : 0;
    const mine = ev.mode === 'days'
      ? state.mySlots.has(key)
      : [...state.mySlots].some(s => s.startsWith(key));
    const attr = ev.mode === 'days' ? `data-paint="${key}"` : `data-open="${key}"`;
    const title = names.length ? ` title="Available: ${esc(names.join(', '))}"` : '';
    let myMark = '';
    if (mine) {
      if (ev.mode === 'hours') {
        const h = [...state.mySlots].filter(s => s.startsWith(key)).length * ev.slotMinutes / 60;
        myMark = `<span class="my-mark">${h % 1 ? h.toFixed(1) : h}h</span>`;
      } else {
        myMark = '<span class="my-mark">✓</span>';
      }
    }
    cells += `
      <div class="day active ${mine ? 'mine' : ''}" ${attr} style="--heat:${heat.toFixed(3)}"${title}>
        <span class="num">${d}</span>
        ${myMark}
        ${names.length ? `<span class="badge">${names.length}</span>` : ''}
      </div>`;
  }

  const label = monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return `<div class="month card"><h3>${label}</h3><div class="grid">${cells}</div></div>`;
}

function modalHtml(date) {
  const ev = state.event;
  const sc = slotCounts();
  const total = ev.participants.length;
  const rows = daySlots(ev, date).map(slot => {
    const names = sc.get(slot) || [];
    const heat = total ? names.length / total : 0;
    const mine = state.mySlots.has(slot);
    const title = names.length ? ` title="${esc(names.join(', '))}"` : '';
    return `
    <div class="slot-row">
      <span class="t">${slot.slice(11)}</span>
      <div class="slot ${mine ? 'mine' : ''}" data-paint="${slot}" style="--heat:${heat.toFixed(3)}"${title}>
        <span class="cnt">${names.length}${total ? '/' + total : ''}</span>
      </div>
    </div>`;
  }).join('');

  return `
  <div class="overlay" data-overlay>
    <div class="modal card">
      <header>
        <h3>${niceDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
        <button class="ghost small" data-whole="${date}">Whole day</button>
        <button class="close" data-close aria-label="Close">&times;</button>
      </header>
      <p class="hint">Click or drag to paint the hours that suit you.</p>
      <div class="slots">${rows}</div>
    </div>
  </div>`;
}

function bestHtml() {
  const ev = state.event;
  const total = ev.participants.length;
  if (!total) return '<p class="hint">No companions have signed yet.</p>';
  const entries = [...(ev.mode === 'days' ? dayCounts() : slotCounts())]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
    .slice(0, 5);
  if (!entries.length) return '<p class="hint">No availability marked yet.</p>';
  return '<ol class="best">' + entries.map(([key, names]) => {
    const label = ev.mode === 'days'
      ? niceDate(key)
      : `${niceDate(key.slice(0, 10))} · ${key.slice(11)}`;
    return `<li style="--w:${Math.round(names.length / total * 100)}%" title="${esc(names.join(', '))}">
      <span>${label}</span><b>${names.length}/${total}</b></li>`;
  }).join('') + '</ol>';
}

function companyHtml() {
  const ev = state.event;
  if (!ev.participants.length) return '<p class="hint">Awaiting the first signature…</p>';
  return '<ul class="company">' + ev.participants.map(p => {
    const amount = ev.mode === 'days'
      ? `${p.slots.length}d`
      : `${(p.slots.length * ev.slotMinutes / 60).toLocaleString('en-GB', { maximumFractionDigits: 1 })}h`;
    const me = state.me && p.id === state.me.id;
    const lock = p.hasPassword ? ` ${LOCK_SVG}` : '';
    return `<li${me ? ' class="me"' : ''}><span>${esc(p.name)}${lock}${me ? ' (you)' : ''}</span><b>${amount}</b></li>`;
  }).join('') + '</ul>';
}

// ---------- painting (shared by day cells in days-mode and hour slots in the modal) ----------

function applyPaint(el) {
  const key = el.dataset.paint;
  if (!key || !paint) return;
  if (state.mySlots.has(key) === paint.target) return;
  if (paint.target) state.mySlots.add(key);
  else state.mySlots.delete(key);
  paint.changed = true;
  el.classList.toggle('mine', paint.target);
}

async function saveSlots() {
  const ev = state.event;
  if (!ev || !state.me) return;
  try {
    await api('PUT', `/api/events/${ev.id}/participants/${state.me.id}`, {
      slots: [...state.mySlots],
      token: state.token,
    });
    await refreshEvent(ev.id);
  } catch (err) {
    toast(err.message);
    refreshEvent(ev.id).catch(() => {});
  }
}

function nudgeJoin() {
  const card = document.getElementById('join-card');
  if (!card) return;
  card.classList.remove('attention');
  void card.offsetWidth;
  card.classList.add('attention');
  card.querySelector('input')?.focus();
  toast('Join the company first to sign up');
}

// copy the source day's hour pattern onto another day's slots
function applyCopy(date, el) {
  const target = new Set(copyDrag.pattern.map(t => `${date}T${t}`));
  let changed = false;
  for (const s of daySlots(state.event, date)) {
    const want = target.has(s);
    if (state.mySlots.has(s) !== want) {
      if (want) state.mySlots.add(s);
      else state.mySlots.delete(s);
      changed = true;
    }
  }
  if (changed) {
    copyDrag.changed = true;
    copyDrag.count++;
  }
  el.classList.toggle('mine', copyDrag.pattern.length > 0);
}

document.addEventListener('pointerdown', e => {
  const paintEl = e.target.closest('[data-paint]');
  if (paintEl) {
    e.preventDefault();
    if (!state.me) {
      nudgeJoin();
      return;
    }
    paintEl.releasePointerCapture?.(e.pointerId);
    paint = { target: !state.mySlots.has(paintEl.dataset.paint), changed: false };
    applyPaint(paintEl);
    return;
  }
  const openEl = e.target.closest('[data-open]');
  if (openEl) {
    e.preventDefault();
    openEl.releasePointerCapture?.(e.pointerId);
    copyDrag = { source: openEl.dataset.open, active: false, changed: false, count: 0 };
  }
});

document.addEventListener('pointermove', e => {
  if (paint) {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-paint]');
    if (el) applyPaint(el);
    return;
  }
  if (!copyDrag) return;
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-open]');
  if (!el) return;
  const date = el.dataset.open;
  if (!copyDrag.active) {
    if (date === copyDrag.source) return; // still on the origin day — a click, not a drag
    if (!state.me) {
      copyDrag = null;
      nudgeJoin();
      return;
    }
    copyDrag.active = true;
    copyDrag.pattern = daySlots(state.event, copyDrag.source)
      .filter(s => state.mySlots.has(s))
      .map(s => s.slice(11));
  }
  if (date !== copyDrag.source) applyCopy(date, el);
});

document.addEventListener('pointerup', () => {
  if (paint) {
    const { changed } = paint;
    paint = null;
    if (changed) saveSlots();
    return;
  }
  if (!copyDrag) return;
  const cd = copyDrag;
  copyDrag = null;
  if (!cd.active) {
    // plain click on a day: open the hour picker
    state.openDate = cd.source;
    renderEvent();
  } else if (cd.changed) {
    toast(`Copied ${niceDate(cd.source)} hours to ${cd.count} ${cd.count === 1 ? 'day' : 'days'}`);
    saveSlots();
  }
});

// ---------- global click actions ----------

document.addEventListener('click', e => {
  if (e.target.closest('[data-theme-toggle]')) {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('ste-theme', next);
    document.querySelectorAll('[data-theme-toggle]').forEach(b => {
      b.textContent = next === 'dark' ? 'Daylight' : 'Evening';
    });
    return;
  }
  if (e.target.closest('[data-close]') || e.target.matches('[data-overlay]')) {
    state.openDate = null;
    renderEvent();
    return;
  }
  const whole = e.target.closest('[data-whole]');
  if (whole) {
    if (!state.me) return nudgeJoin();
    const slots = daySlots(state.event, whole.dataset.whole);
    const allOn = slots.every(s => state.mySlots.has(s));
    for (const s of slots) {
      if (allOn) state.mySlots.delete(s);
      else state.mySlots.add(s);
    }
    saveSlots();
    return;
  }
  if (e.target.closest('[data-copy]')) {
    navigator.clipboard.writeText(location.href)
      .then(() => toast('Invite link copied'))
      .catch(() => toast(location.href));
    return;
  }
  if (e.target.closest('[data-leave]')) {
    localStorage.removeItem(`ste-pid-${state.event.id}`);
    localStorage.removeItem(`ste-token-${state.event.id}`);
    state.me = null;
    state.token = null;
    state.mySlots = new Set();
    renderEvent();
  }
});

route();
