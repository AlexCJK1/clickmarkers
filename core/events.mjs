// The office's event bus: everything the page, the phone and the log want to see goes through emit().
// A ring buffer keeps the last few hundred for a page that opens late.
import fs from 'node:fs';
import path from 'node:path';
import { redact } from './secrets.mjs';

const listeners = new Set();
const ring = [];
const RING = 600;
let seq = 0;

let file = '';
/** Keep the wire on disk (append-only) and reload the tail on start, so the page has history after a restart. */
export function persistEvents(dir) {
  file = path.join(dir, 'events.jsonl');
  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').slice(-RING);
    const evs = []; for (const l of lines) { try { const e = JSON.parse(l); if (e && e.type) evs.push(e); } catch {} }
    // Lines written before emit() owned `at` can hold a caller's own time instead of the clock: a tool call's
    // ms into its run, an intake's empty or future booked time. The file is in the order things happened,
    // so a line is repaired when its time is not a clock time or is later than a line written after it
    // (or than now): it takes the time of the good line before it, or, at the head, the good line after it.
    // The old value is kept as `when`. The repair is the same on every start.
    const SLACK = 60000; const bad = new Array(evs.length).fill(false); let after = Date.now();
    for (let i = evs.length - 1; i >= 0; i--) { const at = evs[i].at; if (!(at > 1e12) || at > after + SLACK) bad[i] = true; else after = Math.min(after, at); }
    const firstGood = evs.find((e, i) => !bad[i])?.at; let last = 0;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (bad[i]) { if (e.at !== undefined && e.when === undefined) e.when = e.at; e.at = last || firstGood || fs.statSync(file).mtimeMs; }
      last = e.at; ring.push(e); seq = Math.max(seq, e.seq || 0);
    }
    if (fs.statSync(file).size > 8e6) { fs.writeFileSync(file, lines.join('\n') + '\n'); }
  } catch {}
}
export function emit(type, data = {}) {
  // seq, at and type are the bus's own: a caller's own time (a call's ms into its run, an intake's booked
  // time) travels as `when`, never over the clock time every reader sorts and groups by
  const { seq: _s, at: when, type: _t, ...rest } = data;
  const ev = { ...rest, ...(when !== undefined ? { when } : {}), seq: ++seq, at: Date.now(), type };
  ring.push(ev); if (ring.length > RING) ring.shift();
  for (const fn of listeners) { try { fn(ev); } catch {} }
  if (file && type !== 'say') { try { fs.appendFileSync(file, JSON.stringify(ev) + '\n'); } catch {} }
  return ev;
}
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function recent(n = 200, since = 0) { return ring.filter(e => e.seq > since).slice(-n); }

const ts = () => new Date().toISOString().slice(11, 19);
export const log = {
  info: (...a) => console.log(ts(), ...a.map(x => redact(typeof x === 'string' ? x : JSON.stringify(x)))),
  warn: (...a) => console.warn(ts(), 'warn:', ...a.map(x => redact(typeof x === 'string' ? x : (x && x.message) || JSON.stringify(x)))),
};
