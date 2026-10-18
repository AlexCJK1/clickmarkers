import { test } from 'node:test';
process.env.NIGHTDESK_NO_MODELS = '1'; // no test may reach a model
process.env.NIGHTDESK_NO_LOCAL = '1'; // nor read this machine's office.config.local.json
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Ledger } from '../core/ledger.mjs';
import { Lanes, classifyApiError } from '../core/lanes.mjs';
import { dueSlot, dayKey, hhmm } from '../core/clock.mjs';
import { Tickets } from '../company/tickets.mjs';
import { loadSecrets, secret, redact } from '../core/secrets.mjs';
import { loadConfig } from '../core/config.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'co-'));

test('ledger: totals, desk room, ceiling', () => {
  const l = new Ledger({ dir: tmp(), ceilingUsd: 1, perRunUsd: 0.5, defaultAgentUsd: 0.4 });
  l.record({ agent: 'a', lane: 'api', usd: 0.3, estUsd: 0.3 });
  l.record({ agent: 'b', lane: 'plan', usd: 0, estUsd: 0.2 });
  const d = l.day();
  assert.equal(d.usd, 0.3); assert.equal(d.estUsd, 0.5); assert.equal(d.runs, 2); assert.equal(d.byAgent.a, 0.3);
  assert.equal(l.room('a', 0.4).cap, 0.1); // desk has 0.1 left
  assert.equal(l.room('c', 0.4).cap, 0.4); // fresh desk: min(perRun 0.5, office 0.7, desk 0.4)
  l.record({ agent: 'c', lane: 'api', usd: 0.7, estUsd: 0.7 });
  assert.equal(l.room('d', 5).cap, 0); assert.match(l.room('d', 5).reason, /ceiling/);
  const l2 = new Ledger({ dir: l.file.file.replace(/ledger\.jsonl$/, ''), ceilingUsd: 1 });
  assert.equal(l2.rows.length, 3, 'ledger reloads from disk');
});

test('lanes: the API key or nothing; no room means wait, no key means it cannot run', () => {
  const l = new Ledger({ dir: tmp(), ceilingUsd: 1, perRunUsd: 0.5, defaultAgentUsd: 0.4 });
  const lanes = new Lanes({ apiCooldownMin: 1, ledger: l });
  const agent = { id: 'a', budgetUsd: 0.4 };
  delete process.env.ANTHROPIC_API_KEY;
  assert.deepEqual([lanes.pick(agent).lane, lanes.pick(agent).wait], ['', false]); assert.match(lanes.pick(agent).reason, /ANTHROPIC_API_KEY/);
  process.env.ANTHROPIC_API_KEY = 'sk-test-xxxxxxxx';
  assert.deepEqual(lanes.pick(agent), { lane: 'api', reason: 'api', capUsd: 0.4 });
  lanes.apiDown('credit balance is too low');
  assert.equal(lanes.pick(agent).lane, ''); assert.equal(lanes.pick(agent).wait, true); assert.match(lanes.pick(agent).reason, /resting/);
  lanes.apiUp();
  l.record({ agent: 'a', lane: 'api', usd: 0.4 });
  assert.equal(lanes.pick(agent).lane, ''); assert.match(lanes.pick(agent).reason, /desk budget/);
  assert.equal(lanes.pick({ id: 'b', budgetUsd: 1 }).lane, 'api');
  l.record({ agent: 'b', lane: 'api', usd: 0.7 }); assert.match(lanes.pick({ id: 'c', budgetUsd: 1 }).reason, /ceiling/);
  assert.equal(JSON.stringify(lanes.state()).includes('plan'), false, 'there is no plan lane');
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(classifyApiError('Your credit balance is too low to access the Anthropic API'), 'billing');
  assert.equal(classifyApiError('invalid x-api-key', 401), 'auth');
  assert.equal(classifyApiError('overloaded_error'), 'rate');
  assert.equal(classifyApiError('something else'), '');
});

test('clock: slots fire once', () => {
  const tz = 'Europe/London';
  const now = Date.parse('2026-10-12T08:00:00+01:00'); // Monday 08:00 London
  assert.equal(dayKey(now, tz), '2026-10-12'); assert.equal(hhmm(now, tz), '08:00');
  assert.equal(dueSlot({ kind: 'daily', at: '07:45' }, { now, tz }), '2026-10-12 07:45');
  assert.equal(dueSlot({ kind: 'daily', at: '07:45' }, { now, tz, lastKey: '2026-10-12 07:45' }), null);
  assert.equal(dueSlot({ kind: 'daily', at: '09:00' }, { now, tz }), null);
  assert.equal(dueSlot({ kind: 'weekly', at: '07:00', days: [1] }, { now, tz }), '2026-10-12 07:00');
  assert.equal(dueSlot({ kind: 'weekly', at: '07:00', days: [0] }, { now, tz }), null);
  assert.equal(dueSlot({ kind: 'weekdays', at: '07:00' }, { now, tz }), '2026-10-12 07:00');
  assert.equal(dueSlot({ kind: 'hourly', minute: 0 }, { now, tz }), '2026-10-12 08:00');
  assert.ok(dueSlot({ kind: 'every', minutes: 30 }, { now, tz }).startsWith('every '));
});

test('tickets: lifecycle, parents and restart recovery', () => {
  const dir = tmp();
  const T = new Tickets(dir);
  const p = T.create({ text: 'plan the week', agent: 'mlead', dept: 'marketing' });
  assert.equal(p.state, 'next'); assert.equal(p.title, 'plan the week');
  const c = T.create({ text: 'render three posts', agent: 'gfx', dept: 'marketing', parent: p.id });
  assert.deepEqual(T.get(p.id).children, [c.id]);
  assert.equal(T.childrenDone(p.id), false);
  T.update(c.id, { state: 'done', result: 'ok' });
  assert.equal(T.childrenDone(p.id), true);
  T.update(p.id, { state: 'doing' });
  const T2 = new Tickets(dir);
  assert.equal(T2.get(p.id).state, 'next', 'a run cut off by a restart goes back to the queue');
  assert.match(T2.get(p.id).note, /restarted/);
  assert.deepEqual(T2.nextUp(new Set(['mlead'])).map(t => t.id), []);
  assert.deepEqual(T2.nextUp(new Set()).map(t => t.id), [p.id]);
});

test('secrets: file values resolve and are redacted, never printed', () => {
  const f = path.join(tmp(), '.secrets.local');
  fs.writeFileSync(f, '# comment\nFOO_TOKEN="abcdefgh12345"\nBAR=short\n');
  assert.equal(loadSecrets(f), 2);
  assert.equal(secret('FOO_TOKEN'), 'abcdefgh12345');
  assert.equal(redact('token abcdefgh12345 leaked'), 'token *** leaked');
});

test('secrets: writeSecret replaces or appends a line and keeps the rest', async () => {
  const { writeSecret } = await import('../io/connect-meta.mjs');
  const f = path.join(tmp(), '.secrets.local');
  fs.writeFileSync(f, '# keys\nA=1\nMETA_MCP_TOKEN=old\nB=2\n');
  writeSecret(f, 'META_MCP_TOKEN', 'new'); writeSecret(f, 'C', '3');
  assert.equal(fs.readFileSync(f, 'utf8'), '# keys\nA=1\nMETA_MCP_TOKEN=new\nB=2\nC=3\n');
});

test('the tests never read the machine\'s own config; the office does', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  fs.writeFileSync(path.join(root, 'office.config.json'), JSON.stringify({ port: 4700 }));
  fs.writeFileSync(path.join(root, 'office.config.local.json'), JSON.stringify({ port: 4800, stats: { file: 'C:/somewhere/stats.json' } }));
  assert.equal(process.env.NIGHTDESK_NO_LOCAL, '1');
  const t = loadConfig(root); assert.equal(t.port, 4700); assert.equal(t.stats, undefined, 'no local stats path in a test');
  delete process.env.NIGHTDESK_NO_LOCAL;
  try { const live = loadConfig(root); assert.equal(live.port, 4800); assert.equal(live.stats.file, 'C:/somewhere/stats.json'); }
  finally { process.env.NIGHTDESK_NO_LOCAL = '1'; }
});

test('an event\'s time is the bus\'s clock: a caller\'s own time travels as `when`, and old lines are repaired on load', async () => {
  const { emit, recent, persistEvents } = await import('../core/events.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-')); const t = 1791819415024;
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [
    { seq: 900001, at: t, type: 'run', agent: 'cos', stage: 'start' },
    { seq: 900002, at: 9134, type: 'call', agent: 'cos', server: 'google-drive', tool: 'drive_search' },
    { seq: 900003, type: 'intake', agent: 'cos', by: 'cli' },
  ].map(e => JSON.stringify(e)).join('\n') + '\n');
  persistEvents(dir);
  const back = recent(600, 900000);
  assert.deepEqual(back.map(e => e.seq), [900001, 900002, 900003]);
  assert.ok(back.every(e => e.at === t), 'each repaired line takes the time of the line before it');
  assert.equal(back[1].when, 9134, 'the old elapsed time is kept as when');
  const ev = emit('call', { agent: 'cos', server: 'x', tool: 'y', at: 5, seq: 1, type: 'nope' });
  assert.equal(ev.type, 'call'); assert.ok(ev.at > 1e12); assert.equal(ev.when, 5); assert.ok(ev.seq > 900003);
  const written = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).at(-1);
  assert.equal(written.seq, ev.seq); assert.ok(written.at > 1e12);
  const plain = emit('phone', { state: 'on' }); assert.equal(plain.when, undefined, 'no when unless the caller gave a time');
});

test('old lines repaired on load: a bad head takes the first good time, a future booked time is not a clock time, all-bad stays put', async () => {
  const { recent, persistEvents } = await import('../core/events.mjs');
  const load = (rows, base) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-')); fs.writeFileSync(path.join(dir, 'events.jsonl'), rows.map(e => JSON.stringify(e)).join('\n') + '\n'); persistEvents(dir); return recent(600, base); };
  const t = Date.now() - 3 * 86400000;
  // a bad head (calls before the first run line)
  let r = load([{ seq: 910001, at: 4000, type: 'call' }, { seq: 910002, type: 'intake' }, { seq: 910003, at: t, type: 'run' }, { seq: 910004, at: t + 5000, type: 'run' }], 910000);
  assert.deepEqual(r.map(e => e.at), [t, t, t, t + 5000], 'the head takes the first good time, never the load time');
  // an old booked intake: its future time is a booked time, not when it happened
  r = load([{ seq: 920001, at: t, type: 'run' }, { seq: 920002, at: Date.now() + 86400000, type: 'intake' }, { seq: 920003, at: t + 7000, type: 'run' }], 920000);
  assert.deepEqual(r.map(e => e.at), [t, t, t + 7000]); assert.ok(r[1].when > Date.now(), 'the booked time is kept as when');
  // a booked time later than the line after it, even if already past
  r = load([{ seq: 930001, at: t, type: 'run' }, { seq: 930002, at: t + 3600000, type: 'intake' }, { seq: 930003, at: t + 9000, type: 'run' }], 930000);
  assert.deepEqual(r.map(e => e.at), [t, t, t + 9000]);
  // every line bad: they keep one time (the file's), the same on every load, and their order
  r = load([{ seq: 940001, at: 1, type: 'call' }, { seq: 940002, at: 2, type: 'call' }], 940000);
  assert.equal(r[0].at, r[1].at); assert.ok(r[0].at > 1e12); assert.deepEqual(r.map(e => e.seq), [940001, 940002]);
});
