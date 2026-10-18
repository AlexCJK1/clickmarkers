import { test } from 'node:test';
process.env.CLICKMARKERS_NO_MODELS = '1'; // no test may reach a model
process.env.CLICKMARKERS_NO_LOCAL = '1'; // nor read this machine's office.config.local.json
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, ROOT } from '../core/config.mjs';
import { Office } from '../company/office.mjs';
import { runPhase } from '../engines/index.mjs';

// The tests run on the full example company (templates/agency); the starter in company/ is only five desks.
const AGENCY = {
  company: path.join(ROOT, 'templates', 'agency', 'company.json'),
  routines: path.join(ROOT, 'templates', 'agency', 'routines.json'),
  workflows: path.join(ROOT, 'templates', 'agency', 'workflows.json'),
};

const brain = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-'));
  fs.mkdirSync(path.join(d, '00-Meta'));
  fs.writeFileSync(path.join(d, '00-Meta/index.md'), '# Index');
  return d;
};
const office = () => {
  const o = new Office(
    loadConfig(ROOT, {
      ...AGENCY,
      secretsFile: '',
      brain: brain(),
      data: fs.mkdtempSync(path.join(os.tmpdir(), 'data-')),
    }),
  );
  o.paused = true;
  return o;
};
const ok = (lane, usd = 0.1) => ({
  ok: true,
  text: 'done\nNOTHING TO SEND',
  error: '',
  kind: '',
  cost: { usd: lane === 'api' ? usd : 0, estUsd: usd, tokens: {} },
  timings: { bootMs: 1, modelMs: 2, totalMs: 3 },
  calls: [],
  mcp: [],
  model: 'm',
  lane,
  turns: 1,
  missing: [],
});
const fail = (kind, error, lane = 'api') => ({ ...ok(lane, 0.2), ok: false, text: '', error, kind });

test('runPhase: every run is on the API key; a billing failure rests the API and the jobs wait (never a subscription)', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test-xxxxxxxx';
  const o = office();
  const t = o.tickets.create({ text: 'x', agent: 'gfx', dept: 'marketing' });
  const lanes = [];
  const r = await runPhase(o, t, 'draft', {
    engines: {
      agent: async ({ lane }) => {
        lanes.push(lane);
        return fail('billing', 'Your credit balance is too low');
      },
    },
  });
  assert.deepEqual(lanes, ['api']);
  assert.equal(r.ok, false);
  assert.ok(o.lanes.state().apiDown, 'the API is resting');
  const r2 = await runPhase(o, t, 'draft', {
    engines: {
      agent: async ({ lane }) => {
        lanes.push(lane);
        return ok(lane);
      },
    },
  });
  assert.equal(lanes.length, 1, 'while it rests, nothing runs');
  assert.equal(r2.kind, 'wait');
  assert.match(r2.error, /resting/);
  o.lanes.apiUp();
  assert.equal((await runPhase(o, t, 'draft', { engines: { agent: async ({ lane }) => ok(lane) } })).ok, true);
  delete process.env.ANTHROPIC_API_KEY;
});

test('runPhase: past the desk budget or the ceiling the job waits; with no key at all it fails plainly', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test-xxxxxxxx';
  const o = office();
  const t = o.tickets.create({ text: 'x', agent: 'gfx', dept: 'marketing' });
  const r = await runPhase(o, t, 'draft', {
    engines: { agent: async ({ lane, capUsd }) => ({ ...ok(lane), capUsd }) },
  });
  assert.equal(r.ok, true);
  assert.ok(r.capUsd > 0, 'a per-run cap is passed');
  o.ledger.record({ agent: 'gfx', lane: 'api', usd: 5 });
  const r2 = await runPhase(o, t, 'draft', {
    engines: {
      agent: async () => {
        throw new Error('must not run');
      },
    },
  });
  assert.equal(r2.kind, 'wait');
  assert.match(r2.error, /desk budget/);
  delete process.env.ANTHROPIC_API_KEY;
  const r3 = await runPhase(o, o.tickets.create({ text: 'x', agent: 'newt', dept: 'marketing' }), 'draft', {
    engines: {
      agent: async () => {
        throw new Error('must not run');
      },
    },
  });
  assert.equal(r3.ok, false);
  assert.equal(r3.kind, 'config');
  assert.match(r3.error, /ANTHROPIC_API_KEY/);
});

test('the heartbeat leaves a job waiting while its desk has no room, and starts it when room comes back', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test-xxxxxxxx';
  const o = office();
  o.paused = false;
  o.routines.due = () => [];
  const started = [];
  o.run = async t => {
    started.push(t.id);
  };
  const t = o.tickets.create({ text: 'x', agent: 'gfx', dept: 'marketing' });
  o.ledger.record({ agent: 'gfx', lane: 'api', usd: 5 });
  await o.tick();
  assert.deepEqual(started, []);
  assert.equal(o.tickets.get(t.id).state, 'next');
  o.ledger.rows = [];
  await o.tick();
  assert.deepEqual(started, [t.id]);
  delete process.env.ANTHROPIC_API_KEY;
  o.stop();
});

test('runPhase: a desk on another model is never re-run on Claude when that model fails; batch without a key runs nothing', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test-xxxxxxxx';
  delete process.env.OPENROUTER_API_KEY;
  const o = office();
  const t2 = o.tickets.create({ text: 'x', agent: 'newt', dept: 'marketing', engine: 'openrouter' });
  const r2 = await runPhase(o, t2, 'draft', {
    engines: {
      agent: async () => {
        throw new Error('must not run on Claude: the owner chose another model for this desk');
      },
      openrouter: async () => fail('auth', 'no OPENROUTER_API_KEY', 'openrouter'),
    },
  });
  assert.equal(r2.ok, false);
  assert.equal(r2.engine, 'openrouter');
  assert.match(r2.error, /not run on Claude/);
  delete process.env.ANTHROPIC_API_KEY;
  const t3 = o.tickets.create({ text: 'x', agent: 'newt', dept: 'marketing', engine: 'batch' });
  const r3 = await runPhase(o, t3, 'draft', {
    engines: {
      agent: async ({ lane }) => ok(lane),
      messages: async () => {
        throw new Error('must not be called without a key');
      },
    },
  });
  assert.equal(r3.ok, false);
  assert.match(r3.error, /ANTHROPIC_API_KEY/, 'no key: nothing runs, on any engine');
});

test('runPhase: a desk with a claude.ai connector does not run (that would need a subscription login)', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test-xxxxxxxx';
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reg-')), 'c.json');
  fs.writeFileSync(f, JSON.stringify({ old: { type: 'inherit', server: 'claude.ai Canva', label: 'Canva' } }));
  const o = office();
  o.connectors = new o.connectors.constructor(f);
  o.company.agent('gfx').tools = ['old'];
  const t = o.tickets.create({ text: 'x', agent: 'gfx', dept: 'marketing' });
  const r = await runPhase(o, t, 'draft', {
    engines: {
      agent: async () => {
        throw new Error('must not run');
      },
    },
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /subscription login/);
  delete process.env.ANTHROPIC_API_KEY;
});
