'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

const MAX_RANGE_DAYS = 92;
const MAX_BODY = 1024 * 1024;

let data = { events: {} };
try {
  data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch {
  /* first run — start empty */
}

// migrate participants created before auth existed
for (const ev of Object.values(data.events)) {
  for (const p of ev.participants) {
    if (!p.token) p.token = crypto.randomBytes(16).toString('base64url').slice(0, 16);
    if (p.passwordHash === undefined) p.passwordHash = null;
  }
}

function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

const newId = (n = 10) => crypto.randomBytes(n).toString('base64url').slice(0, n);
const pad = n => String(n).padStart(2, '0');

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// destroy plans whose last day has passed
function purgeExpired() {
  const today = todayStr();
  let removed = false;
  for (const [id, ev] of Object.entries(data.events)) {
    if (ev.endDate < today) {
      delete data.events[id];
      removed = true;
    }
  }
  if (removed) save();
}

function* eachDate(startDate, endDate) {
  const [y1, m1, d1] = startDate.split('-').map(Number);
  const [y2, m2, d2] = endDate.split('-').map(Number);
  let d = new Date(y1, m1 - 1, d1);
  const end = new Date(y2, m2 - 1, d2);
  while (d <= end) {
    yield `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
}

function spanDays(startDate, endDate) {
  const [y1, m1, d1] = startDate.split('-').map(Number);
  const [y2, m2, d2] = endDate.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000) + 1;
}

function validSlots(ev) {
  const set = new Set();
  for (const date of eachDate(ev.startDate, ev.endDate)) {
    if (ev.mode === 'days') {
      set.add(date);
    } else {
      for (let m = ev.startHour * 60; m < ev.endHour * 60; m += ev.slotMinutes) {
        set.add(`${date}T${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
      }
    }
  }
  return set;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function createEvent(body) {
  const name = String(body.name || '').trim().slice(0, 100);
  const mode = body.mode === 'days' ? 'days' : 'hours';
  const { startDate, endDate } = body;
  if (!name) throw new Error('Event name is required');
  if (!DATE_RE.test(startDate || '') || !DATE_RE.test(endDate || '')) throw new Error('Invalid dates');
  if (endDate < startDate) throw new Error('End date is before start date');
  if (endDate < todayStr()) throw new Error('Last day is already in the past');
  if (spanDays(startDate, endDate) > MAX_RANGE_DAYS) throw new Error(`Range is limited to ${MAX_RANGE_DAYS} days`);

  const ev = {
    id: newId(),
    name,
    mode,
    startDate,
    endDate,
    createdAt: new Date().toISOString(),
    participants: [],
  };

  if (mode === 'hours') {
    const startHour = Number(body.startHour);
    const endHour = Number(body.endHour);
    const slotMinutes = Number(body.slotMinutes);
    if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) throw new Error('Invalid earliest hour');
    if (!Number.isInteger(endHour) || endHour < 1 || endHour > 24) throw new Error('Invalid latest hour');
    if (endHour <= startHour) throw new Error('Latest hour must be after earliest hour');
    if (![30, 60].includes(slotMinutes)) throw new Error('Invalid slot length');
    Object.assign(ev, { startHour, endHour, slotMinutes });
  }

  data.events[ev.id] = ev;
  save();
  return ev;
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(8).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}

function checkPassword(stored, pw) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(pw, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

// what the joining user gets back: includes their secret token
const ownParticipant = p => ({ id: p.id, name: p.name, slots: p.slots, token: p.token });

// what everyone sees in GET /api/events/:id — no token, no hash
const publicEvent = ev => ({
  ...ev,
  participants: ev.participants.map(p => ({
    id: p.id,
    name: p.name,
    slots: p.slots,
    hasPassword: !!p.passwordHash,
  })),
});

function joinEvent(ev, body) {
  const name = String(body.name || '').trim().slice(0, 50);
  const password = String(body.password || '').slice(0, 100);
  if (!name) throw new Error('Name is required');
  const existing = ev.participants.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (existing.passwordHash) {
      if (!password || !checkPassword(existing.passwordHash, password)) {
        const err = new Error('Wrong password for this name');
        err.status = 403;
        throw err;
      }
    } else if (password) {
      // name was unprotected — first join that brings a password locks it
      existing.passwordHash = hashPassword(password);
      save();
    }
    return ownParticipant(existing);
  }
  const p = {
    id: newId(),
    token: newId(16),
    name,
    slots: [],
    passwordHash: password ? hashPassword(password) : null,
  };
  ev.participants.push(p);
  save();
  return ownParticipant(p);
}

function setAvailability(ev, participant, body) {
  if (typeof body.token !== 'string' || body.token !== participant.token) {
    const err = new Error('Not authorized to edit this availability');
    err.status = 403;
    throw err;
  }
  if (!Array.isArray(body.slots)) throw new Error('slots must be an array');
  const valid = validSlots(ev);
  participant.slots = [...new Set(body.slots.map(String))].filter(s => valid.has(s)).sort();
  save();
  return ownParticipant(participant);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) && file !== path.join(PUBLIC, 'index.html')) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) {
      purgeExpired();
      let m;
      if (req.method === 'POST' && pathname === '/api/events') {
        sendJson(res, 201, publicEvent(createEvent(await readBody(req))));
        return;
      }
      if ((m = pathname.match(/^\/api\/events\/([\w-]+)$/)) && req.method === 'GET') {
        const ev = data.events[m[1]];
        if (!ev) return sendJson(res, 404, { error: 'Event not found' });
        return sendJson(res, 200, publicEvent(ev));
      }
      if ((m = pathname.match(/^\/api\/events\/([\w-]+)\/join$/)) && req.method === 'POST') {
        const ev = data.events[m[1]];
        if (!ev) return sendJson(res, 404, { error: 'Event not found' });
        return sendJson(res, 200, joinEvent(ev, await readBody(req)));
      }
      if ((m = pathname.match(/^\/api\/events\/([\w-]+)\/participants\/([\w-]+)$/)) && req.method === 'PUT') {
        const ev = data.events[m[1]];
        if (!ev) return sendJson(res, 404, { error: 'Event not found' });
        const p = ev.participants.find(x => x.id === m[2]);
        if (!p) return sendJson(res, 404, { error: 'Participant not found' });
        return sendJson(res, 200, setAvailability(ev, p, await readBody(req)));
      }
      return sendJson(res, 404, { error: 'Not found' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    serveStatic(req, res, pathname);
  } catch (err) {
    sendJson(res, err.status || 400, { error: err.message || 'Bad request' });
  }
});

purgeExpired();
setInterval(purgeExpired, 60 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`⛰  Sign To Erebor is listening on http://localhost:${PORT}`);
});
