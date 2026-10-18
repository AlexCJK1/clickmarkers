// Configuration: office.config.json (committed defaults) under office.config.local.json (the machine's
// own values, never committed). Paths are resolved against the install folder. Secrets never live here;
// see secrets.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULTS = {
  name: 'Clickmarkers',
  business: 'Your business',
  host: '127.0.0.1',
  port: 4600,
  timezone: 'Europe/London',
  brain: '', // the vault folder (markdown notes, stats, inbox)
  company: 'company/company.json',
  routines: 'company/routines.json',
  workflows: 'company/workflows.json',
  connectors: 'company/connectors.json',
  data: 'data', // tickets, ledger, state
  secretsFile: '', // KEY=VALUE lines; read by the runtime only
  fx: { gbpPerUsd: 0 }, // set it (0.75, say) to see pounds beside the dollars; the API bills in USD
  ledger: { ceilingUsd: 10, perRunUsd: 1.0, defaultAgentUsd: 2.0 },
  lanes: { apiCooldownMin: 30, claudePath: '', maxTurns: 40, toolSearch: 'true', maxToolDescription: 600 },
  notes: { business: 4000, each: 10000, n: 6, inboxEach: 4000 },
  heartbeat: { everySec: 15, maxParallel: 2 },
  routing: { model: 'sonnet' },
  telegram: { enabled: true, hello: true, routines: true, transcribe: 'local' },
  media: { roots: [] }, // folders whose pictures and videos may be sent to the phone
  google: { account: '', callbackPort: 8765 }, // the only Google account the office may sign in as (clickmarkers connect google)
  // The EVALUATIONS desk checks a draft before the owner sees it. maxRounds counts checks, not revisions:
  // 1 is one look and no send back, 2 (the default) is one revision, 3 is two.
  evaluations: { enabled: true, maxRounds: 2, model: 'opus', effort: 'medium' },
};

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])
        ? deepMerge(a[k], v)
        : v;
  }
  return out;
}
const readJson = f => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`${path.basename(f)}: ${e.message}`);
  }
};

export function loadConfig(root = ROOT, overrides = {}) {
  let cfg = deepMerge(DEFAULTS, readJson(path.join(root, 'office.config.json')) || {});
  // CLICKMARKERS_NO_LOCAL=1 (the tests): the machine's own values never leak in, so a test reads the same config on
  // every machine (one machine's own stats file and folders once made two tests pass on one machine and fail on another)
  if (process.env.CLICKMARKERS_NO_LOCAL !== '1')
    cfg = deepMerge(cfg, readJson(path.join(root, 'office.config.local.json')) || {});
  cfg = deepMerge(cfg, overrides);
  // the CLI tests point a whole process at a throwaway data folder, so a test run never writes into a real office
  if (process.env.CLICKMARKERS_NO_LOCAL === '1' && process.env.CLICKMARKERS_DATA)
    cfg.data = process.env.CLICKMARKERS_DATA;
  const abs = p => (p ? path.resolve(root, p) : '');
  cfg.root = root;
  cfg.brain = abs(cfg.brain);
  cfg.company = abs(cfg.company);
  cfg.routines = abs(cfg.routines);
  cfg.workflows = abs(cfg.workflows);
  cfg.connectors = abs(cfg.connectors);
  cfg.data = abs(cfg.data);
  cfg.secretsFile = abs(cfg.secretsFile);
  cfg.media.roots = (cfg.media.roots || []).map(abs);
  if (cfg.files?.roots) cfg.files = { ...cfg.files, roots: cfg.files.roots.map(abs) }; // the folders opened to file_read, against the install folder
  return cfg;
}

export function problems(cfg) {
  const out = [];
  if (!cfg.brain) out.push('brain: no vault folder set (office.config.local.json → "brain")');
  else if (!fs.existsSync(cfg.brain)) out.push(`brain: folder not found: ${cfg.brain}`);
  if (!fs.existsSync(cfg.company)) out.push(`company: file not found: ${cfg.company}`);
  if (!fs.existsSync(cfg.connectors)) out.push(`connectors: file not found: ${cfg.connectors}`);
  if (cfg.secretsFile && !fs.existsSync(cfg.secretsFile)) out.push(`secretsFile: not found: ${cfg.secretsFile}`);
  return out;
}
