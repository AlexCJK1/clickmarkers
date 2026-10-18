// The page without an office: serves the built page (web/dist) and answers /api/* from a folder of
// captured API answers, so the look can be checked and rendered anywhere. Nothing reaches a model, a
// connector or the network; writes are answered and forgotten.
//
//   npm run build && npm run ui:fixtures -- --dir <folder> [--port 4610] [--demo] [--live] [--at <ISO>]
//
// The folder holds one JSON file per answer and _manifest.json mapping "/api/path?query" to
// { file, status } (the shape the page's capture script writes). It is business data: keep it in
// data/fixtures (git-ignored) or pass --dir; it is never committed.
// --demo turns one finished ticket into a draft waiting for the OK, with an evaluations verdict, so the
// in-tray can be seen full. --live adds a wire event every few seconds. --at fixes the page's clock
// (default: the moment the answers were captured, from /api/stats).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { draftHash } from '../company/tickets.mjs';
import { evalLine } from '../company/evals.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = k => process.argv.includes(`--${k}`);
const DIR = path.resolve(arg('dir', process.env.NIGHTDESK_FIXTURES || path.join(ROOT, 'data', 'fixtures')));
const PORT = +arg('port', process.env.PORT || 4610);
const DIST = path.join(ROOT, 'web', 'dist');
if (!fs.existsSync(path.join(DIR, '_manifest.json'))) { console.error(`No fixtures in ${DIR} (expected _manifest.json). Pass --dir <folder> or set NIGHTDESK_FIXTURES.`); process.exit(1); }
if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('No built page in web/dist: run npm run build first.'); process.exit(1); }

const manifest = JSON.parse(fs.readFileSync(path.join(DIR, '_manifest.json'), 'utf8'));
const read = key => { const m = manifest[key]; if (!m) return undefined; try { return JSON.parse(fs.readFileSync(path.join(DIR, m.file), 'utf8')); } catch { return undefined; } };
const data = Object.fromEntries(Object.keys(manifest).map(k => [k, read(k)]));
const get = p => data[p];
const company = get('/api/company'); const tickets = get('/api/tickets?n=200') || []; const ledger = get('/api/ledger?days=14'); const connectors = get('/api/connectors') || []; const health = get('/api/health') || {};
const stats = get('/api/stats');
const CLOCK = Date.parse(arg('at', '')) || (stats?.updatedAt ? Date.parse(stats.updatedAt) + 24 * 60000 : Date.now());

/* ---------- the demo: one draft waiting for the OK ---------- */
if (flag('demo') && tickets.length) {
  const t = tickets.find(x => x.state === 'done' && /post|caption|draft/i.test(x.title)) || tickets.find(x => x.state === 'done');
  if (t) {
    const draft = String(t.result || 'The draft as the desk wrote it.');
    const ev = { verdict: 'fix', rounds: 2, problems: [{ unit: 'Caption B, second post', reason: 'quotes a weekly figure the facts note does not hold', fix: 'use the window price from the facts note' }], notes: ['One link in the draft has no tracking tag.'], by: 'code+model' };
    Object.assign(t, { state: 'waiting', needsOk: true, phase: 'draft', updatedAt: CLOCK - 6 * 60000, eval: ev, evalRounds: 2, evalProblems: ev.problems, evalLine: evalLine(ev), draftHash: draftHash(draft), result: draft.slice(0, 6000), draft });
    health.counts = { ...(health.counts || {}), waiting: 1, done: Math.max(0, (health.counts?.done || 1) - 1) };
  }
}

/* ---------- the wire, rebuilt from what the answers hold ---------- */
const events = [];
for (const t of tickets) events.push({ type: 'intake', agent: t.agent, by: t.by || 'owner', at: t.createdAt, ticket: t.id });
for (const r of ledger?.recent || []) { events.push({ type: 'run', stage: 'start', agent: r.agent, at: r.at - (r.ms || 0), ticket: r.ticket }); events.push({ type: 'run', stage: 'done', agent: r.agent, at: r.at, ms: r.ms, usd: r.usd, lane: r.lane, ticket: r.ticket }); }
for (const c of connectors) if (c.health?.at && !c.disabled) events.push({ type: 'connector', key: c.key, status: c.health.status, tools: c.health.tools, at: c.health.at });
if (health.phone?.on) events.push({ type: 'phone', state: 'on', bot: health.phone.bot, at: CLOCK - 51 * 60000 });
for (const t of tickets) if (t.state === 'waiting') events.push({ type: 'run', stage: 'waiting', agent: t.agent, at: t.updatedAt, ticket: t.id });
events.sort((a, b) => a.at - b.at); events.forEach((e, i) => { e.seq = i + 1; });
let seq = events.length;

/* ---------- answers ---------- */
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const body = req => new Promise(r => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
const desks = []; const walk = n => { desks.push(n); (n.reports || []).forEach(walk); }; (company?.tree || []).forEach(walk);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const clockScript = `<script>(()=>{const off=${CLOCK}-Date.now();const D=Date;class FD extends D{constructor(...a){if(a.length)super(...a);else super(D.now()+off)}static now(){return D.now()+off}}window.Date=FD;})();</script>`;
const subscribers = new Set();
const emit = e => { const ev = { seq: ++seq, at: Date.now() + (CLOCK - START), ...e }; events.push(ev); for (const res of subscribers) res.write(`data: ${JSON.stringify(ev)}\n\n`); };
const START = Date.now();

function calendarFor(from, to) {
  const keys = Object.keys(data).filter(k => k.startsWith('/api/calendar?'));
  const exact = keys.find(k => k === `/api/calendar?from=${from}&to=${to}`); if (exact) return data[exact];
  // the closest captured range, shifted: the page asks from the day it thinks it is
  let best = null, bo = -1; for (const k of keys) { const u = new URLSearchParams(k.split('?')[1]); const f = +u.get('from'), t = +u.get('to'); const o = Math.min(t, to) - Math.max(f, from); if (o > bo) { bo = o; best = data[k]; } }
  return best || { from, to, routines: [], scheduled: [], done: [], open: [] };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const p = url.pathname; const m = req.method; const key = p + url.search;
  if (p === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    const since = +url.searchParams.get('since') || 0; for (const e of events.filter(x => x.seq > since).slice(-150)) res.write(`data: ${JSON.stringify(e)}\n\n`);
    subscribers.add(res); const ping = setInterval(() => res.write(': ping\n\n'), 20000); req.on('close', () => { subscribers.delete(res); clearInterval(ping); }); return;
  }
  if (p.startsWith('/api/')) {
    if (m === 'GET') {
      // a ticket is answered from the tickets in memory (the demo and an approve change them), with any
      // captured detail for it laid underneath
      const one = p.match(/^\/api\/tickets\/([^/]+)$/);
      if (one) { const t = tickets.find(x => x.id === one[1]); if (!t) return json(res, 404, { error: 'no such ticket' }); return json(res, 200, { calls: [], reads: [], ...(data[key] || {}), ...t, draft: t.state === 'waiting' ? t.draft || '' : '', draftHash: t.state === 'waiting' ? t.draftHash : '' }); }
      if (key in data && data[key] !== undefined) {
        if (key === '/api/tickets?n=200') return json(res, 200, tickets.map(t => { const { draft, ...b } = t; return b; }));
        if (key === '/api/health') return json(res, 200, { ...health, build: 'fixtures' });
        return json(res, manifest[key].status || 200, data[key]);
      }
      if (p === '/api/health') return json(res, 200, { ...health, build: 'fixtures' });
      if (p === '/api/calendar') return json(res, 200, calendarFor(+url.searchParams.get('from'), +url.searchParams.get('to')));
      const am = p.match(/^\/api\/agents\/([^/]+)$/); if (am) { const d = desks.find(x => x.id === am[1]); return d ? json(res, 200, { ...d, does: d.role, brief: '', lessons: { rules: [], oneoffs: [] }, notebook: '', routines: (get('/api/routines') || []).filter(r => r.agent === d.id), connectors: (d.tools || []).map(k => connectors.find(c => c.key === k) || { key: k }), today: ledger?.today?.byAgent?.[d.id] || 0, team: (d.reports || []).map(r => r.id), web: false }) : json(res, 404, { error: 'no such desk' }); }
      if (p.startsWith('/api/chat/')) return json(res, 200, { messages: [], interview: null, lead: false, setUp: false });
      if (p === '/api/brain/note') return json(res, 200, { rel: url.searchParams.get('rel'), text: 'The note text is not part of the fixtures.' });
      return json(res, 404, { error: 'not in the fixtures' });
    }
    const b = await body(req);
    if (p === '/api/when') return json(res, 200, { at: 0 });
    if (p === '/api/routines/parse') { const t = String(b.text || ''); const at = t.match(/(\d{1,2})(?::(\d\d))?\s*(am|pm)?/i); return json(res, 200, at ? { ok: true, whenText: `daily ${String((+at[1] % 12) + (/pm/i.test(at[3] || '') ? 12 : 0)).padStart(2, '0')}:${at[2] || '00'}`, task: t.replace(/^.*?(am|pm|\d\d:\d\d)\s*/i, '') } : { ok: false, ask: 'time' }); }
    if (p === '/api/tickets') { const t = { id: `fx${seq}`, title: String(b.text || '').slice(0, 70), state: b.at ? 'scheduled' : 'next', agent: b.agent || 'cos' }; emit({ type: 'intake', agent: t.agent, by: 'owner' }); return json(res, 200, t); }
    if (/\/approve$/.test(p)) { const id = p.split('/')[3]; const t = tickets.find(x => x.id === id); if (!b.hash) return json(res, 409, { error: 'reload: the draft has changed or the page is old' }); if (t && b.hash !== t.draftHash) return json(res, 409, { error: 'the draft has changed since this page showed it' }); if (t) { t.state = 'done'; t.updatedAt = Date.now(); } emit({ type: 'approval', agent: t?.agent, verdict: 'approved', ticket: id }); return json(res, 200, t || { ok: true }); }
    if (/\/reject$/.test(p)) { const id = p.split('/')[3]; const t = tickets.find(x => x.id === id); if (t) { t.state = 'next'; t.updatedAt = Date.now(); } emit({ type: 'approval', agent: t?.agent, verdict: 'sent back', note: b.note }); return json(res, 200, t || { ok: true }); }
    return json(res, 200, { ok: true, fixtures: true });
  }
  // the page, with its clock set to the capture time
  let f = path.join(DIST, p === '/' ? 'index.html' : p.replace(/^\/+/, '')); if (!f.startsWith(DIST)) return json(res, 403, { error: 'no' });
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  const ext = path.extname(f);
  if (ext === '.html') { res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' }); return res.end(fs.readFileSync(f, 'utf8').replace('<head>', `<head>${clockScript}`)); }
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(res);
});
if (flag('live')) {
  const ids = desks.map(d => d.id); let i = 0;
  setInterval(() => { const a = ids[(i++ * 7) % ids.length]; emit(i % 3 ? { type: 'run', stage: 'start', agent: a } : { type: 'run', stage: 'done', agent: a, ms: 12000 + (i % 5) * 3000, usd: 0.02 * (i % 4 + 1), lane: 'api' }); }, 4000);
}
server.listen(PORT, '127.0.0.1', () => console.log(`Fixtures from ${DIR} on http://127.0.0.1:${PORT}/ (clock ${new Date(CLOCK).toISOString()}${flag('demo') ? ', demo in-tray' : ''}${flag('live') ? ', live wire' : ''})`));
