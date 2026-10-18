// The features brought across in the cross-check with the old office: plain-words schedules and
// routine controls, booked jobs, effort, lessons, deliverable notes, the calendar, the brain map,
// desk chat and the set-up interview, the plan gauge and the direct stats call.
// No network, no model: the quick model calls are stood in for.
import { test } from 'node:test';
process.env.NIGHTDESK_NO_MODELS = '1'; // no test may reach a model
process.env.NIGHTDESK_NO_LOCAL = '1'; // nor read this machine's office.config.local.json
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, ROOT } from '../core/config.mjs';
import { Office } from '../company/office.mjs';
import { parseWhen, parseAt, hasRecurrence } from '../core/when.mjs';
import { dueSlot, slotsBetween, nextRun, describeWhen, zonedTime } from '../core/clock.mjs';
import { systemPrompt } from '../engines/prompt.mjs';
import { buildGraph, readNote } from '../brain/graph.mjs';
import { callDirect } from '../engines/mcpcall.mjs';
import { serve } from '../io/server.mjs';
// finishRun takes a result only for a ticket that is "doing" that phase, as it is when a run ends
const doing = (o, id) => (o.tickets.update(id, { state: 'doing' }), id);

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const copy = rel => { const f = path.join(tmp('co-'), path.basename(rel)); fs.copyFileSync(path.join(ROOT, rel), f); return f; };
const brain = () => {
  const d = tmp('brain-');
  for (const f of ['00-Meta', '10-Business', '40-Marketing']) fs.mkdirSync(path.join(d, f));
  fs.writeFileSync(path.join(d, '00-Meta/index.md'), '# Index\nSee [[facts]] and [[40-Marketing/rulings]].');
  fs.writeFileSync(path.join(d, '10-Business/business.md'), '# Larkspur\nCleans windows.');
  fs.writeFileSync(path.join(d, '10-Business/facts.md'), '# Bristol facts\nWindow price £15. Gutters from £40. [Rulings](../40-Marketing/rulings.md)');
  fs.writeFileSync(path.join(d, '40-Marketing/rulings.md'), '# Rulings\nNo conservatory rate unprompted.');
  return d;
};
const office = (extra = {}) => { const o = new Office(loadConfig(ROOT, { secretsFile: '', brain: brain(), data: tmp('data-'), company: copy('company/company.json'), routines: copy('company/routines.json'), connectors: path.join(ROOT, 'company/connectors.json'), workflows: path.join(ROOT, 'company/workflows.json'), heartbeat: { everySec: 30, maxParallel: 2 }, telegram: { enabled: false }, ...extra })); o.paused = true; o.route = async () => null; return o; };
const NOW = Date.UTC(2026, 9, 12, 11, 0); // Monday 12 October 2026, 12:00 in London

test('when: plain-words schedules read back, and a missing time or day is asked for', () => {
  assert.deepEqual(parseWhen('every weekday at 8am send the inbox digest').when, { kind: 'weekdays', at: '08:00' });
  assert.equal(parseWhen('every weekday at 8am send the inbox digest').task, 'send the inbox digest');
  assert.deepEqual(parseWhen('every monday and thursday at 9:30 review the funnel').when, { kind: 'weekly', at: '09:30', days: [1, 4] });
  assert.deepEqual(parseWhen('weekends at noon post a reel').when, { kind: 'weekly', at: '12:00', days: [0, 6] });
  assert.equal(parseWhen('every morning brief me').guess, true, 'a part of the day is a guess');
  assert.deepEqual(parseWhen('every 2 hours between 9 and 5 on weekdays check leads').when, { kind: 'hourly', minute: 0, step: 2, from: '09:00', to: '17:00', days: [1, 2, 3, 4, 5] });
  assert.deepEqual(parseWhen('every 30 minutes ping').when, { kind: 'every', minutes: 30 });
  assert.equal(parseWhen('weekly review the spend').ask, 'day');
  assert.equal(parseWhen('check the page every day').ask, 'time');
  assert.equal(parseWhen('three posts on the spring offer').ok, false);
  assert.equal(hasRecurrence('three posts on the spring offer'), false);
  assert.equal(describeWhen({ kind: 'weekly', at: '12:00', days: [0, 6] }), 'Sat/Sun 12:00');
});

test('when: a one-off moment at the start of a message, in London time', () => {
  const at = (s) => parseAt(s, { now: NOW, tz: 'Europe/London' });
  assert.equal(at('tomorrow 9am: post the spring offer').at, zonedTime(2026, 10, 13, 9, 0));
  assert.equal(at('tomorrow 9am: post the spring offer').task, 'post the spring offer');
  assert.equal(at('fri 10:30 - check spend').at, zonedTime(2026, 10, 16, 10, 30));
  assert.equal(at('14 oct at 8: send pack').at, zonedTime(2026, 10, 14, 8, 0));
  assert.equal(at('14/10 17:00, reel').at, zonedTime(2026, 10, 14, 17, 0));
  assert.equal(at('monday 9: weekly').at, zonedTime(2026, 10, 19, 9, 0), 'a weekday whose time has passed today means next week');
  assert.equal(at('in 2 hours: chase leads').at, NOW + 7200000);
  assert.equal(at('marketing: three posts'), null);
  assert.equal(at('the spring offer: z'), null);
  // across the clocks going back (25 October): 09:00 is still 09:00 on the wall
  assert.equal(new Date(parseAt('26/10 9am: x', { now: NOW }).at).toISOString(), '2026-10-26T09:00:00.000Z');
});

test('clock: hourly steps and windows, slots for the calendar, the next run', () => {
  const w = { kind: 'hourly', minute: 0, step: 2, from: '09:00', to: '17:00', days: [1, 2, 3, 4, 5] };
  assert.equal(dueSlot(w, { now: zonedTime(2026, 10, 12, 10, 5) }), null, '10:00 is off the 2-hour step from 9');
  assert.ok(dueSlot(w, { now: zonedTime(2026, 10, 12, 11, 5) }));
  assert.equal(dueSlot(w, { now: zonedTime(2026, 10, 11, 11, 5) }), null, 'Sunday is off');
  const s = slotsBetween(w, NOW, NOW + 86400000);
  assert.deepEqual(s.map(t => new Date(t).getUTCHours()), [12, 14, 16, 8, 10]);
  assert.equal(nextRun({ kind: 'weekly', at: '09:00', days: [1] }, NOW), zonedTime(2026, 10, 19, 9, 0));
  assert.equal(slotsBetween({ kind: 'every', minutes: 30 }, NOW, NOW + 3 * 86400000).length, 0, 'minute cadences stay off a wide calendar');
});

test('routines from the page and the phone: add from a sentence, edit, pause, run now, find', async () => {
  const o = office();
  const r = await o.addRoutine({ sentence: 'every weekday at 7:45 pull the morning numbers', agent: 'dash' });
  assert.equal(r.routine.agent, 'dash'); assert.equal(r.whenText, 'weekdays 07:45'); assert.equal(r.routine.text, 'pull the morning numbers');
  assert.ok(o.routines.get(r.routine.id));
  await assert.rejects(o.addRoutine({ sentence: 'weekly pull numbers', agent: 'dash' }), /Which day/);
  await assert.rejects(o.addRoutine({ sentence: 'every day pull numbers', agent: 'dash' }), /What time/);
  const e = o.editRoutine(r.routine.id, { sentence: 'daily at 6pm', title: 'Evening numbers', needsOk: true });
  assert.deepEqual(e.when, { kind: 'daily', at: '18:00' }); assert.equal(e.title, 'Evening numbers'); assert.equal(e.needsOk, true);
  assert.throws(() => o.editRoutine(r.routine.id, { agent: 'nobody' }), /no desk/);
  o.routines.pause(r.routine.id, true); assert.equal(o.routines.get(r.routine.id).paused, true); assert.equal(o.routines.view().find(x => x.id === r.routine.id).nextAt, 0);
  const t = await o.runRoutine(r.routine.id); assert.equal(t.routine, r.routine.id); assert.equal(t.by, 'routine'); assert.equal(t.agent, 'dash');
  assert.equal(o.routines.find('evening numbers').id, r.routine.id);
  assert.equal(o.routines.find('numbers'), null, 'two routines share the word: no single match');
  o.stop();
});

test('booked jobs wait for their time, run once when it comes (late is noted), and a past time is refused', async () => {
  const o = office();
  const t = await o.submit({ text: 'DESIGN: three posts', at: Date.now() + 3600000, effort: 'high', model: 'sonnet' });
  assert.equal(t.state, 'scheduled'); assert.equal(t.effort, 'high'); assert.equal(t.model, 'sonnet');
  await o.tick(); assert.equal(o.tickets.get(t.id).state, 'scheduled');
  o.tickets.update(t.id, { at: Date.now() - 600000 });
  await o.tick(); assert.equal(o.tickets.get(t.id).state, 'next'); assert.match(o.tickets.get(t.id).note, /ran late/);
  await assert.rejects(o.submit({ text: 'DESIGN: x', at: Date.now() - 3600000 }), /passed/);
  await assert.rejects(o.submit({ text: 'DESIGN: x', model: 'fable' }), /unknown model/);
  await assert.rejects(o.submit({ text: 'DESIGN: x', effort: 'huge' }), /unknown effort/);
  assert.throws(() => o.company.save('gfx', { model: 'claude-fable-5-1' }), /not allowed/);
  assert.equal(o.company.save('gfx', { effort: 'high' }).effort, 'high');
  const c = o.cancel(t.id); assert.equal(c.state, 'cancelled');
  o.stop();
});

test('lessons: a correction becomes a standing rule in the desk prompt; a one-off does not; questions teach nothing', async () => {
  const o = office();
  const answers = [{ kind: 'rule', rule: 'Never quote the conservatory rate unprompted.' }, { kind: 'oneoff', rule: 'Used the blue van photo.' }, { kind: 'none', rule: '' }];
  o.quickJson = async () => answers.shift();
  const t = await o.submit({ text: 'COPY: spring offer post', needsOk: true });
  o.tickets.update(t.id, { state: 'waiting', draft: 'Post: £15 a day, conservatory £150.' });
  o.reject(t.id, 'leave the conservatory rate out');
  await new Promise(r => setTimeout(r, 20));
  o.tickets.update(t.id, { state: 'done', result: 'Post.' });
  await o.reply(t.id, 'use the blue van photo this time'); await new Promise(r => setTimeout(r, 20));
  await o.reply(t.id, 'how many people saw it?'); await new Promise(r => setTimeout(r, 20));
  const l = o.vault.lessons(t.agent);
  assert.deepEqual(l.rules.map(x => x.text), ['Never quote the conservatory rate unprompted.']);
  assert.deepEqual(l.oneoffs.map(x => x.text), ['Used the blue van photo.']);
  const sys = systemPrompt({ company: o.company, agent: o.company.agent(t.agent), connectors: o.connectors, vault: o.vault });
  assert.match(sys, /Lessons from the owner[\s\S]*Never quote the conservatory rate/); assert.doesNotMatch(sys, /blue van/);
  assert.equal(o.vault.removeLesson(t.agent, 'rule', 0), true); assert.equal(o.vault.lessons(t.agent).rules.length, 0);
  o.stop();
});

test('a finished job is saved in the brain as a dated note with the notes it read', async () => {
  const o = office();
  const t = await o.submit({ text: 'NUMBERS: the window price in Bristol facts' });
  const reads = o.readsFor(o.tickets.get(t.id), o.company.agent(t.agent));
  assert.ok(reads.includes('10-Business/facts.md'));
  o.tickets.update(t.id, { reads });
  await o.finishRun(doing(o, t.id), 'draft', { ok: true, text: 'Window price £15.\nNOTHING TO SEND', lane: 'plan', engine: 'agent', model: 'claude-sonnet-5-5', cost: { usd: 0, estUsd: 0.02 }, timings: {}, calls: [{ server: 'shopfront', tool: 'ads_overview' }] });
  const done = o.tickets.get(t.id); assert.equal(done.state, 'done'); assert.match(done.deliverable, /^Nightdesk\/deliverables\/\d{4}-\d{2}-\d{2} \d{4} /);
  const body = fs.readFileSync(path.join(o.cfg.brain, done.deliverable), 'utf8');
  assert.match(body, /Window price £15/); assert.match(body, /tools: shopfront\.ads_overview/); assert.match(body, /\[\[10-Business\/facts\]\]/);
  o.stop();
});

test('calendar: routine slots ahead, booked jobs and finished work in one window', async () => {
  const o = office();
  const b = await o.submit({ text: 'DESIGN: reel', at: Date.now() + 2 * 3600000 });
  const d = await o.submit({ text: 'DESIGN: post' }); o.tickets.update(d.id, { state: 'done', timings: { finishedAt: Date.now() - 3600000 } });
  const c = o.calendar(Date.now() - 86400000, Date.now() + 7 * 86400000);
  assert.ok(c.routines.some(r => r.slots.length > 0));
  assert.deepEqual(c.scheduled.map(x => x.id), [b.id]);
  assert.ok(c.done.some(x => x.id === d.id));
  o.stop();
});

test('brain map: notes and their links; a note is read only from inside the brain', () => {
  const b = brain(); const g = buildGraph(b);
  const idx = Object.fromEntries(g.notes.map(n => [n.rel, n.i]));
  const has = (x, y) => g.links.some(([p, q]) => (p === idx[x] && q === idx[y]) || (p === idx[y] && q === idx[x]));
  assert.ok(has('00-Meta/index.md', '10-Business/facts.md'), 'wiki link by name');
  assert.ok(has('00-Meta/index.md', '40-Marketing/rulings.md'), 'wiki link by path');
  assert.ok(has('10-Business/facts.md', '40-Marketing/rulings.md'), 'markdown link');
  assert.equal(readNote(b, '../etc/passwd'), null); assert.equal(readNote(b, '10-Business/facts.md').text.startsWith('# Bristol'), true);
  fs.mkdirSync(path.join(b, '.hidden')); fs.writeFileSync(path.join(b, '.hidden/x.md'), 'x'); assert.equal(readNote(b, '.hidden/x.md'), null);
});

test('desk chat: an answer from the desk prompt, "job:" places a job, history is kept', async () => {
  const o = office(); let seen = null;
  o.quick = async opts => { seen = opts; return { text: 'Working on the spring offer posts.', lane: 'plan' }; };
  const r = await o.chat.say('gfx', 'What are you working on?');
  assert.equal(r.reply, 'Working on the spring offer posts.'); assert.equal(seen.agent, 'gfx'); assert.equal(seen.phase, 'chat');
  assert.match(seen.system, /Your desk: DESIGN/, 'the chat reuses the desk system prompt (same cache)');
  const j = await o.chat.say('gfx', 'job: three posts on the spring offer'); assert.ok(j.ticket); assert.equal(o.tickets.get(j.ticket).agent, 'gfx');
  await o.chat.say('gfx', 'and the reel?');
  assert.deepEqual(seen.history.map(h => h.role), ['user', 'assistant', 'user', 'assistant'], 'earlier turns alternate and start with the owner');
  assert.equal(o.chat.history('gfx').length, 6);
  o.stop();
});

test('set-up interview: five questions, then briefs and a skill written after a backup', async () => {
  const o = office(); const mk = o.company.dept('marketing');
  o.quick = async () => ({ text: JSON.stringify({ briefs: { mlead: 'Run marketing for the Page. Every post goes through COMPLY first. New: weekly plan on Sundays.', newt: 'Write captions in the house voice. New: lead with the window price.', zzz: 'not a desk here' }, skill: { name: 'spring-post', description: 'A post on the spring offer', desks: ['newt'], steps: '1. Facts. 2. Draft.', shape: 'Hook, two lines, CTA.', rules: '- No conservatory rate', template: 'HOOK\nLINE\nCTA' }, summary: 'Briefs for the lead and COPY; one skill.', tryThis: 'COPY: a spring offer post' }), lane: 'plan' });
  let r = await o.chat.say('mlead', 'set up'); assert.match(r.reply, /1\/5/);
  for (let i = 0; i < 4; i++) { r = await o.chat.say('mlead', i === 2 ? 'skip' : `answer ${i}`); assert.match(r.reply, new RegExp(`${i + 2}/5`)); }
  r = await o.chat.say('mlead', 'the Page, Canva and the shopfront server');
  assert.match(r.reply, /Written: .*brief: .*skill: spring-post/);
  assert.match(o.company.agent('mlead').brief, /weekly plan on Sundays/);
  assert.ok(o.company.agent('newt').skills.includes('spring-post')); assert.ok(o.company.agent('mlead').skills.includes('spring-post'));
  assert.ok(fs.existsSync(path.join(o.cfg.brain, 'skills/spring-post/SKILL.md'))); assert.ok(fs.existsSync(path.join(o.cfg.brain, 'skills/spring-post/template.md')));
  assert.equal(fs.readdirSync(path.join(o.cfg.data, 'backups')).length, 1);
  assert.equal(o.chat.setUp(mk.id), true); assert.equal(o.chat.interviewState(mk.id), null);
  r = await o.chat.say('mlead', 'set up'); r = await o.chat.say('mlead', 'cancel'); assert.match(r.reply, /Nothing was written/);
  r = await o.chat.say('newt', 'set up'); assert.notEqual(r.reply, undefined); assert.doesNotMatch(r.reply, /1\/5/, 'only a lead interviews');
  o.stop();
});

test('no subscription: the office never reads a Claude sign-in, never asks for plan usage, never runs a desk without the API key', () => {
  const src = ['engines/agent.mjs', 'engines/index.mjs', 'engines/health.mjs', 'io/server.mjs', 'company/office.mjs'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.doesNotMatch(src, /credentials\.json|oauth\/usage|claudeAiOauth/);
  assert.equal(fs.existsSync(path.join(ROOT, 'io/usage.mjs')), false);
  assert.doesNotMatch(src, /settingSources: \['user'\]/, 'no run loads the owner\'s own Claude Code login setup');
});

test('direct calls: only the allow-listed stats job', async () => {
  const o = office();
  const r = await callDirect(o, 'shopfront', 'page_schedule_post'); assert.equal(r.ok, false); assert.match(r.error, /not a direct call/);
  o.stop();
});

test('server: the new routes answer (parse, when, routines, calendar, chat, brain, lessons)', async () => {
  const o = office({ port: 0, host: '127.0.0.1' }); o.quick = async () => ({ text: 'Hello.', lane: 'plan' });
  const srv = serve(o); await new Promise(r => srv.once('listening', r)); const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
  assert.equal((await post('/api/routines/parse', { text: 'daily 7:30 check pacing' })).whenText, 'daily 07:30');
  assert.ok((await post('/api/when', { text: 'tomorrow 9am: x' })).at > Date.now());
  const add = await post('/api/routines', { sentence: 'every friday at 4pm weekly wrap', agent: 'report' }); assert.equal(add.routine.agent, 'report');
  assert.equal((await post(`/api/routines/${add.routine.id}/pause`)).paused, true);
  assert.equal((await post(`/api/routines/${add.routine.id}`, { title: 'Friday wrap' })).title, 'Friday wrap');
  assert.equal((await post('/api/routines', { sentence: 'weekly wrap' })).error.length > 0, true);
  const cal = await fetch(`${base}/api/calendar?from=${Date.now()}&to=${Date.now() + 7 * 86400000}`).then(r => r.json()); assert.ok(Array.isArray(cal.routines));
  assert.equal((await post('/api/chat/gfx', { text: 'hi' })).reply, 'Hello.');
  assert.equal((await fetch(`${base}/api/chat/gfx`).then(r => r.json())).messages.length, 2);
  const g = await fetch(`${base}/api/brain/graph`).then(r => r.json()); assert.ok(g.notes.length >= 4);
  assert.equal((await fetch(`${base}/api/brain/note?rel=../x.md`)).status, 404);
  assert.equal((await post('/api/tickets', { text: 'DESIGN: x', at: Date.now() - 7200000 })).error.length > 0, true);
  const ag = await fetch(`${base}/api/agents/gfx`).then(r => r.json()); assert.deepEqual(ag.lessons, { rules: [], oneoffs: [] });
  srv.closeAllConnections(); srv.close(); o.stop();
});

/* ---------- review findings, each pinned ---------- */
import { buildRequest } from '../engines/messages.mjs';
import { merge3 } from '../scripts/merge-live.mjs';
import { Phone } from '../io/telegram.mjs';

test('API engines: before the OK only known, non-outbound remote tools are on; an unprobed server is left out', () => {
  const o = office(); process.env.META_MCP_TOKEN = 'test-token-xxxxxxxx';
  try {
    const desk = { ...o.company.agent('ada'), tools: ['meta-ads-remote'], toolsOnly: {} };
    const t = { id: 'x', title: 'spend', text: 'spend', comments: [], parent: null, engine: 'oneshot' };
    const reg = o.connectors.get('meta-ads-remote'); const kept = reg.known; const keptOnly = reg.only; delete reg.known; delete reg.only; // the outbound rules alone here; the "only" list has its own test
    assert.equal((buildRequest({ office: o, ticket: t, agent: desk, phase: 'draft' }).body.mcp_servers || []).length, 0, 'tool names unknown: not trusted before the OK');
    if (kept) reg.known = kept;
    o.health_.state.servers['meta-ads-remote'] = { status: 'connected', names: ['ads_get_insights', 'ads_create_campaign', 'ads_update_entity', 'ads_get_ad_entities'], at: Date.now() };
    for (const phase of ['draft', 'wrap']) {
      const r = buildRequest({ office: o, ticket: t, agent: desk, phase }); const ts = r.body.tools.find(x => x.type === 'mcp_toolset');
      assert.equal(ts.default_config.enabled, false);
      assert.deepEqual(Object.keys(ts.configs).filter(k => ts.configs[k].enabled).sort(), ['ads_get_ad_entities', 'ads_get_insights']);
    }
    // after the OK: the reads and the outbound tools the approved steps name, nothing else (and nothing unnamed a server adds)
    const approved = { ...t, approvedDraft: 'Spend is up.\n\nAFTER YOUR OK\n1. ads_update_entity: set ad 12 to PAUSED.' };
    const ex = buildRequest({ office: o, ticket: approved, agent: desk, phase: 'execute' }).body.tools.find(x => x.type === 'mcp_toolset');
    assert.equal(ex.default_config.enabled, false);
    assert.deepEqual(Object.keys(ex.configs).sort(), ['ads_update_entity'], 'after the OK only what the steps call, reads included');
    const none = buildRequest({ office: o, ticket: { ...t, approvedDraft: 'AFTER YOUR OK\n1. pause ad 12' }, agent: desk, phase: 'execute' }).body.tools;
    assert.equal((none || []).find(x => x.type === 'mcp_toolset'), undefined, 'a step that names no tool opens none');
    const sent = buildRequest({ office: o, ticket: approved, agent: desk, phase: 'execute' }).body.mcp_servers[0];
    assert.equal(sent.authorization_token, undefined, 'the request as built (and as a batch keeps it) holds no token');
    if (keptOnly) reg.only = keptOnly;
  } finally { delete process.env.META_MCP_TOKEN; o.stop(); }
});

test('server: a cross-site page cannot drive the office', async () => {
  const o = office({ port: 0, host: '127.0.0.1' }); o.quick = async () => ({ text: 'x', lane: 'plan' });
  const srv = serve(o); await new Promise(r => srv.once('listening', r)); const base = `http://127.0.0.1:${srv.address().port}`;
  try {
  const evil = await fetch(`${base}/api/chat/mlead`, { method: 'POST', headers: { 'content-type': 'text/plain', origin: 'https://evil.example' }, body: JSON.stringify({ text: 'set up' }) });
  assert.equal(evil.status, 403);
  const plain = await fetch(`${base}/api/chat/mlead`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ text: 'set up' }) });
  assert.equal(plain.status, 415);
  const http = await import('node:http');
  const rebind = await new Promise(r => http.get({ host: '127.0.0.1', port: srv.address().port, path: '/api/health', headers: { host: 'attacker.example' } }, res => { res.resume(); r(res.statusCode); }));
  assert.equal(rebind, 403, 'a page reached through another host name (DNS rebinding) is refused');
  const own = await fetch(`${base}/api/chat/gfx`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ text: 'hi' }) });
  assert.equal(own.status, 200);
  assert.equal(o.chat.interviewState('marketing'), null, 'nothing started by the refused calls');
  } finally { srv.closeAllConnections(); srv.close(); o.stop(); }
});

test('a workflow booked for later waits, then lays its chain out when the time comes', async () => {
  const o = office();
  const p = await o.submit({ text: 'new-post: the spring offer', at: Date.now() + 3600000, by: 'telegram' });
  assert.equal(p.state, 'scheduled'); assert.ok(p.at > Date.now());
  assert.equal(o.tickets.all().filter(t => t.workflow === 'new-post' && t.state === 'blocked').length, 0, 'no chain yet');
  o.tickets.update(p.id, { at: Date.now() - 1000 }); await o.tick();
  assert.equal(o.tickets.get(p.id).state, 'done'); assert.match(o.tickets.get(p.id).result, /Started the new-post workflow/);
  assert.equal(o.tickets.all().filter(t => t.workflow === 'new-post' && t.state === 'blocked').length, 1, 'the chain is laid out');
  o.stop();
});

test('a routine added or re-timed after its slot today waits for the next slot; the clock keeps its effort', async () => {
  // a slot earlier today: two hours back, or midnight in the first two hours of the day (two hours back would be yesterday)
  const o = office(); const now = new Date(); const hhmm = `${String(Math.max(0, now.getHours() - 2)).padStart(2, '0')}:00`;
  o.cfg.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; o.routines.tz = o.cfg.timezone;
  const r = o.saveRoutine({ id: 'late-one', agent: 'dash', text: 'numbers', when: { kind: 'daily', at: hhmm }, effort: 'high' });
  await o.tick(); assert.equal(o.tickets.all().filter(t => t.routine === 'late-one').length, 0, 'not fired at once');
  o.routines.fired['late-one'] = 'an older slot'; await o.tick();
  const fired = o.tickets.all().filter(t => t.routine === 'late-one'); assert.equal(fired.length, 1); assert.equal(fired[0].effort, 'high');
  assert.throws(() => o.saveRoutine({ id: 'bad', agent: 'gfx', text: 'x', when: { kind: 'every', minutes: 1 } }), /5 to 1440/);
  assert.throws(() => o.saveRoutine({ id: 'bad', agent: 'gfx', text: 'x', when: { kind: 'daily', at: '08:00' }, model: 'claude-fable-5' }), /unknown model/);
  assert.equal(r.effort, 'high');
  o.stop();
});

test('schedules: words inside the task are not the schedule', () => {
  const w = s => parseWhen(s);
  assert.deepEqual(w('every friday at 4pm send the weekend rota').when, { kind: 'weekly', at: '16:00', days: [5] });
  assert.equal(w('every friday at 4pm send the weekend rota').task, 'send the weekend rota');
  assert.deepEqual(w('daily at 8am chase anyone who missed saturday').when, { kind: 'daily', at: '08:00' });
  assert.deepEqual(w('every day at 18:00 plan the 7am start').when, { kind: 'daily', at: '18:00' });
  assert.deepEqual(w('every day at 8:30 check the 5pm collections').when, { kind: 'daily', at: '08:30' });
  assert.deepEqual(w('send the weekend rota every friday at 4pm').when, { kind: 'weekly', at: '16:00', days: [5] });
  assert.equal(w('every monday 3 posts').ask, 'time');
  assert.equal(new Date(parseAt('tonight 8: post the reel', { now: NOW }).at).toISOString(), '2026-10-12T19:00:00.000Z');
});

test('the set-up interview keeps the answers when the write-up fails, and takes nothing in while it writes', async () => {
  const o = office(); let release; let calls = 0;
  o.quick = async () => { calls++; if (calls === 1) return null; await new Promise(r => { release = r; }); return { text: JSON.stringify({ briefs: { mlead: 'Run marketing. New: plan on Sundays.' }, skill: { name: 'weekly-plan', steps: '1', shape: 's', rules: 'r', desks: [] }, summary: 'ok' }) }; };
  await o.chat.say('mlead', 'set up'); for (let i = 0; i < 5; i++) await o.chat.say('mlead', `answer ${i}`);
  assert.equal(o.chat.interviewState('marketing').answers.length, 5, 'kept after the failed write-up');
  const again = o.chat.say('mlead', 'set up');
  await new Promise(r => setTimeout(r, 20));
  const meanwhile = await o.chat.say('mlead', 'and another thing');
  assert.match(meanwhile.reply, /Still writing/);
  release(); const done = await again; assert.match(done.reply, /Written: brief/);
  assert.equal(calls, 2, 'one write-up at a time');
  o.stop();
});

test('phone: /pause with a general word pauses the office; with a routine name, that routine', async () => {
  const o = office(); const sent = []; const ph = new Phone(o); ph.on = true; ph.chat = '1'; ph.send = async t => { sent.push(t); return { message_id: sent.length }; }; o.phone = ph;
  o.paused = false;
  await ph.handle({ message: { chat: { id: 1 }, text: '/pause now' } }); assert.equal(o.paused, true);
  await ph.handle({ message: { chat: { id: 1 }, text: '/resume' } }); assert.equal(o.paused, false);
  await ph.handle({ message: { chat: { id: 1 }, text: '/pause morning numbers' } }); assert.equal(o.routines.get('morning-numbers')?.paused ?? o.routines.find('morning numbers')?.paused, true); assert.equal(o.paused, false);
  await ph.handle({ message: { chat: { id: 1 }, text: '/pause zebra crossing' } }); assert.match(sent[sent.length - 1], /No single routine/); assert.equal(o.paused, false);
  o.paused = true; o.stop();
});

test('drops keep the owner\'s live changes: a three-way merge of the company files', () => {
  const base = { agents: [{ id: 'gfx', brief: 'b', paused: false }, { id: 'newt', brief: 'n' }], rules: ['a'] };
  const live = { agents: [{ id: 'gfx', brief: 'b', paused: true }, { id: 'newt', brief: 'n2 from the interview' }], rules: ['a'] };
  const drop = { agents: [{ id: 'gfx', brief: 'b new', paused: false }, { id: 'newt', brief: 'n' }, { id: 'seo', brief: 's' }], rules: ['a', 'b'] };
  const c = []; const m = merge3(base, live, drop, '$', c);
  assert.deepEqual(m, { agents: [{ id: 'gfx', brief: 'b new', paused: true }, { id: 'newt', brief: 'n2 from the interview' }, { id: 'seo', brief: 's' }], rules: ['a', 'b'] });
  assert.deepEqual(c, []);
  const r = merge3({ routines: [{ id: 'a', when: 1 }] }, { routines: [{ id: 'a', when: 2 }, { id: 'mine', when: 3 }] }, { routines: [{ id: 'a', when: 5 }] }, '$', c);
  assert.deepEqual(r, { routines: [{ id: 'a', when: 2 }, { id: 'mine', when: 3 }] }); assert.equal(c.length, 1, 'both changed a.when: live kept, clash reported');
});

test('schedules: the time and the recurrence in either order, at either end; task words stay in the task', () => {
  const cases = [
    ['check the page at 9 every day', 'daily 09:00', 'check the page'], ['send the digest at 8am on weekdays', 'weekdays 08:00', 'send the digest'],
    ['chase the leads at 5pm every friday', 'Fri 17:00', 'chase the leads'], ['post a reel at noon on saturdays', 'Sat 12:00', 'post a reel'],
    ['send me the numbers at 7:30 every morning', 'daily 07:30', 'send me the numbers'], ['every friday at 5pm weekly report', 'Fri 17:00', 'weekly report'],
    ['every day at 6pm daily summary', 'daily 18:00', 'daily summary'], ['every day at 9am window price check', 'daily 09:00', 'window price check'],
    ['every day at 8 morning brief', 'daily 08:00', 'morning brief'], ['every sunday at 6pm week ahead plan', 'Sun 18:00', 'week ahead plan'],
    ['every evening at 9 send the wrap', 'daily 21:00', 'send the wrap'], ['at 8am on weekdays send the digest', 'weekdays 08:00', 'send the digest'],
  ];
  for (const [s, when, task] of cases) { const r = parseWhen(s); assert.equal(r.whenText, when, s); assert.equal(r.task, task, s); }
  assert.equal(parseWhen('every monday window price check').ask, 'time');
  assert.equal(parseWhen('meet at 5pm about the van').ok, false);
});

test('API engines keep to the registry "only" list as the agent engine does, before and after the OK', () => {
  const o = office(); process.env.META_MCP_TOKEN = 'test-token-xxxxxxxx';
  try {
    const desk = o.company.agent('ada'); const reg = o.connectors.get('meta-ads-remote');
    if (!reg.only) return; // the registry trims this server; nothing to check without it
    o.health_.state.servers['meta-ads-remote'] = { status: 'connected', names: [...(reg.known || []), 'ads_catalog_create', 'ads_pixel_event_delete', 'ads_get_ad_entities'], at: Date.now() };
    const t = { id: 'x', title: 'spend', text: 'spend', comments: [], parent: null };
    const re = g => new RegExp('^' + g.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    const only = reg.only.map(re), out = (reg.outbound || []).map(re);
    for (const phase of ['draft', 'wrap', 'execute']) {
      const ts = buildRequest({ office: o, ticket: t, agent: { ...desk, tools: ['meta-ads-remote'] }, phase }).body.tools?.find(x => x.type === 'mcp_toolset');
      if (!ts) continue;
      const on = Object.entries(ts.configs || {}).filter(([, v]) => v.enabled).map(([k]) => k);
      assert.equal(ts.default_config?.enabled, false, phase);
      assert.ok(on.every(n => only.some(r => r.test(n))), `${phase}: only-listed tools`);
      if (phase !== 'execute') assert.ok(on.every(n => !out.some(r => r.test(n))), `${phase}: no outbound tool`);
      assert.ok(!on.includes('ads_catalog_create') && !on.includes('ads_pixel_event_delete'));
    }
  } finally { delete process.env.META_MCP_TOKEN; o.stop(); }
});

test('server: the dev page (npm run ui:dev on 4601) may still save', async () => {
  const o = office({ port: 0, host: '127.0.0.1' }); o.quick = async () => ({ text: 'x', lane: 'plan' });
  const srv = serve(o); await new Promise(r => srv.once('listening', r)); const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const r = await fetch(`${base}/api/chat/gfx`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:4601', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ text: 'hi' }) });
    assert.equal(r.status, 200);
  } finally { srv.closeAllConnections(); srv.close(); o.stop(); }
});

test('schedules: a part of the day with a clock time, and small night hours stay in the morning', () => {
  const cases = [['every saturday morning at 10 post a reel', 'Sat 10:00', 'post a reel'], ['every weekday morning at 8 check leads', 'weekdays 08:00', 'check leads'],
    ['every monday evening at 7 send the rota', 'Mon 19:00', 'send the rota'], ['every friday night at 11 back up', 'Fri 23:00', 'back up'],
    ['every day in the evening at 7 send the wrap', 'daily 19:00', 'send the wrap'], ['every night at 1:30 run the cleanup', 'daily 01:30', 'run the cleanup'],
    ['every night at 2 back up the ledger', 'daily 02:00', 'back up the ledger'], ['run the backup at 2 every night', 'daily 02:00', 'run the backup'],
    ['every night at 10 wrap', 'daily 22:00', 'wrap'], ['every saturday morning post a reel', 'Sat 08:00', 'post a reel']];
  for (const [s, when, task] of cases) { const r = parseWhen(s); assert.equal(r.whenText, when, s); assert.equal(r.task, task, s); }
  assert.equal(parseWhen('weekends at noon post a reel').guess, false, 'noon is a clock time, not a guess');
});
