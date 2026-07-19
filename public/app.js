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

const DOOR_SVG = `<svg class="hero-door" viewBox="0 0 88 88" aria-hidden="true">
  <circle class="frame" cx="44" cy="44" r="41"/>
  <circle class="panel" cx="44" cy="44" r="32"/>
  <g class="planks">
    <line x1="44" y1="44" x2="44" y2="13"/>
    <line x1="44" y1="44" x2="71" y2="28"/>
    <line x1="44" y1="44" x2="71" y2="60"/>
    <line x1="44" y1="44" x2="44" y2="75"/>
    <line x1="44" y1="44" x2="17" y2="60"/>
    <line x1="44" y1="44" x2="17" y2="28"/>
  </g>
  <circle class="knob" cx="44" cy="44" r="4.5"/></svg>`;

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

window.addEventListener('hashchange', route);

function route() {
  clearInterval(state.pollTimer);
  state.event = state.me = state.openDate = null;
  state.mySlots = new Set();
  const m = location.hash.match(/^#e\/([\w-]+)/);
  if (m) enterEvent(m[1]);
  else renderCreate();
}

// ---------- create page ----------

function renderCreate() {
  const today = new Date();
  const in13 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 13);
  const hourOpts = (from, to, sel) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i)
      .map(h => `<option value="${h}" ${h === sel ? 'selected' : ''}>${timeLabel(h * 60)}</option>`)
      .join('');

  app.innerHTML = `
  <div class="page narrow">
    <header class="topbar solo">${themeToggleHtml()}</header>
    <header class="hero">
      ${DOOR_SVG}
      <h1>Sign To Erebor</h1>
      <p class="tagline">Gather your company. Find the day the quest begins.</p>
    </header>
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
  </div>`;

  const form = document.getElementById('create-form');
  const syncMode = () => {
    const hours = form.elements.mode.value === 'hours';
    form.querySelector('.hours-only').style.display = hours ? '' : 'none';
  };
  form.addEventListener('change', syncMode);
  syncMode();

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
      location.hash = `e/${ev.id}`;
      toast('Quest created — share the link with your company!');
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
      <div class="card"><p>${esc(err.message)}</p>
        <p class="hint">Plans dissolve once their last day has passed — this one may have run its course.</p>
        <p><a href="#">← Forge a new quest</a></p></div>
    </div>`;
    return;
  }
  state.pollTimer = setInterval(() => {
    if (!paint && !document.hidden && state.event) refreshEvent(id).catch(() => {});
  }, 10000);
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
      <a class="brand" href="#">${MOUNTAIN_SVG} Sign To Erebor</a>
      <span class="topbar-actions">
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
      <section class="calendar">${calendarHtml()}</section>
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

function joinHtml() {
  if (state.me) {
    return `<p>Signing as <b>${esc(state.me.name)}</b>
      <button class="link" data-leave>not you?</button></p>`;
  }
  return `
  <form id="join-form" class="row join-row">
    <input name="name" required maxlength="50" placeholder="Your name" autocomplete="off">
    <input name="password" type="password" maxlength="100" placeholder="Password (optional)" autocomplete="off">
    <button type="submit" class="primary">Join the company</button>
  </form>
  <p class="hint">A password protects your name — without one, anyone entering your name can edit
    your hours. Returning? Enter the same name (and password).</p>`;
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
