#!/usr/bin/env node
// nightdesk: the office from the command line.
//   nightdesk demo [--show]       a demo office with a made-up business: nothing runs, nothing is sent
//                                 (--show replays a scripted day on the floor so the war room moves)
//   nightdesk serve               start the office (API, page, phone, heartbeat)
//   nightdesk check               what is configured, what is missing
//   nightdesk run "<task>"        place one ticket, wait for it, print the result (and the bill)
//   nightdesk tickets [state]     list tickets
//   nightdesk ledger [days]       spend by day and desk
//   nightdesk routines            the standing work and when it fires
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, problems, ROOT } from '../core/config.mjs';
import { secretNames, secret } from '../core/secrets.mjs';
import { Office } from '../company/office.mjs';
import { serve } from '../io/server.mjs';
import { Phone } from '../io/telegram.mjs';
import { subscribe } from '../core/events.mjs';
import { stamp } from '../core/clock.mjs';

const [cmd = 'serve', ...rest] = process.argv.slice(2);
let cfg = loadConfig();

if (cmd === 'demo') {
  // A fresh demo every time, in .demo (ignored by git). No model can be reached and the office starts paused.
  process.env.NIGHTDESK_NO_MODELS = '1';
  const { seedDemo } = await import('../scripts/demo-seed.mjs');
  const p = seedDemo(path.join(ROOT, '.demo'));
  cfg = loadConfig(ROOT, { brain: p.brain, data: p.data, company: p.company, routines: p.routines, workflows: p.workflows, stats: { file: p.stats }, secretsFile: '', demo: true, telegram: { enabled: false }, google: { account: '' } });
  if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') cfg.host = '127.0.0.1';
  console.log(`Demo office: open http://${cfg.host}:${cfg.port} (a made-up business; nothing runs, nothing is sent). Ctrl+C to stop.`);
}

if (cmd === 'serve' || cmd === 'demo') {
  const office = new Office(cfg);
  const fatal = office.company.fatal(); if (fatal.length) { for (const f of fatal) console.error('error:', f); process.exit(1); } // a desk that takes no jobs in a team or as a lead: refuse to start
  const issues = problems(cfg).concat(office.company.validate(), office.exposureLines()); for (const i of issues) console.warn('warn:', i);
  console.log(`${office.company.name} · ${office.company.business} · ${office.company.agents.size} desks · brain ${office.vault.names().length} notes · ledger ceiling $${office.ledger.ceilingUsd}/day${cfg.demo ? '' : secret('ANTHROPIC_API_KEY') ? '' : ' · no ANTHROPIC_API_KEY: nothing can run until it is in the secrets file'}`);
  office.phone = new Phone(office); office.phone.start().then(ok => { if (!ok) console.log('phone: off,', office.phone.reason); });
  try { serve(office); } catch (e) { console.error('error:', e.message); process.exit(1); }
  office.start();
  if (cmd === 'demo' && rest.includes('--show')) { const { startShow, showRuns } = await import('../scripts/demo-show.mjs'); const speed = +(rest.find(a => a.startsWith('--speed='))?.split('=')[1] || 1) || 1; const health = office.health.bind(office); office.health = () => { const h = health(); return { ...h, running: [...(h.running || []), ...showRuns()] }; }; startShow({ speed }); console.log('Show: a scripted day is replayed on the floor every minute or so (no desk runs).'); }
  subscribe(e => { if (['intake', 'run', 'approval', 'lane', 'mcp', 'batch', 'delegate', 'board', 'deny', 'guard', 'workflow', 'connector'].includes(e.type)) console.log(stamp(e.at, cfg.timezone), e.type, JSON.stringify({ ...e, type: undefined, at: undefined, seq: undefined })); });
  const bye = () => { office.stop(); office.phone?.stop(); process.exit(0); }; process.on('SIGINT', bye); process.on('SIGTERM', bye);
} else if (cmd === 'check') {
  const office = new Office(cfg);
  const out = [];
  const ok = (label, good, detail = '') => out.push(`${good ? '  ok ' : ' FAIL'} ${label}${detail ? ': ' + detail : ''}`);
  for (const p of problems(cfg)) ok(p.split(':')[0], false, p.split(':').slice(1).join(':').trim());
  ok('company', office.company.validate().length === 0, `${office.company.agents.size} desks, ${office.company.departments.length} departments${office.company.validate().length ? '; ' + office.company.validate().join('; ') : ''}`);
  for (const line of office.exposureLines()) out.push(`  warn ${line}`);
  ok('brain', office.vault.names().length > 0, `${office.vault.names().length} notes, ${office.vault.inbox().length} in the drop folder`);
  ok('secrets', office.secretsLoaded > 0, `${office.secretsLoaded} in ${cfg.secretsFile || '(none)'}: ${secretNames().join(', ')}`);
  ok('api key', !!secret('ANTHROPIC_API_KEY'), secret('ANTHROPIC_API_KEY') ? 'ANTHROPIC_API_KEY present (read by the runtime only)' : 'no ANTHROPIC_API_KEY: desks cannot run until it is in the secrets file');
  ok('openrouter', true, secret('OPENROUTER_API_KEY') ? 'key present' : 'no key (engine off)');
  for (const c of office.connectors.view()) { if (c.disabled) out.push(`  off  connector ${c.key}: ${c.type}${c.missing.length ? ', needs ' + c.missing.join(', ') : ''}${c.verified ? '' : ', unverified'} (enable in connectors.json)`); else ok(`connector ${c.key}`, !c.missing.length, `${c.type}${c.verified ? '' : ', unverified'}${c.missing.length ? ', needs ' + c.missing.join(', ') : ''}`); }
  const used = new Set([...office.company.agents.values()].flatMap(a => a.tools));
  for (const k of used) if (!office.connectors.get(k)) ok(`connector ${k}`, false, 'used by a desk but not in the registry');
  ok('phone', !!(secret('OFFICE_TELEGRAM_TOKEN') && (secret('OFFICE_TELEGRAM_CHAT') || secret('TELEGRAM_CHAT_ID'))), 'token and chat id');
  ok('routines', true, office.routines.view().map(r => `${r.id} ${r.whenText}`).join('; '));
  ok('ledger', true, `today $${office.ledger.day().usd} of $${office.ledger.ceilingUsd}; ${office.ledger.rows.length} lines`);
  ok('data', fs.existsSync(cfg.data), cfg.data);
  console.log(out.join('\n'));
  if (rest.includes('--connect')) {
    console.log('\nprobing connectors (one tiny session each, on the API key)…');
    const r = await office.health_.probe(rest.filter(x => !x.startsWith('--')).length ? rest.filter(x => !x.startsWith('--')) : null);
    for (const c of r) if (c.health) console.log(`  ${String(c.health.status).padEnd(10)} ${c.key.padEnd(18)} ${c.health.tools} tools${c.health.ms ? ' · ' + Math.round(c.health.ms / 1000) + 's' : ''}${c.health.note ? ' · ' + c.health.note : ''}`);
  }
  process.exit(out.some(l => l.startsWith(' FAIL')) ? 1 : 0);
} else if (cmd === 'run') {
  const text = rest.join(' ').trim(); if (!text) { console.error('nightdesk run "<task>"'); process.exit(2); }
  const office = new Office(cfg);
  subscribe(e => { if (['intake', 'route', 'run', 'call', 'say', 'mcp', 'delegate', 'deny', 'guard'].includes(e.type)) console.error(' ', e.type, JSON.stringify({ ...e, type: undefined, at: undefined, seq: undefined, text: e.text ? e.text.slice(0, 120) : undefined })); });
  const t = await office.submit({ text, by: 'cli' });
  if (office.paused) console.error('  (the office is paused; this one run goes ahead anyway, the pause stays for everything else)');
  office.paused = false; // this process only: the saved pause is not changed
  // this process runs this one ticket (and its children) only: the running office keeps the clock, the bookings and the queue
  office.routines.due = () => []; office.tickets.dueScheduled = () => [];
  const nextUp = office.tickets.nextUp.bind(office.tickets); office.tickets.nextUp = (busy, limit) => nextUp(busy, 500).filter(x => x.id === t.id || x.parent === t.id).slice(0, limit);
  office.start();
  const done = new Set(['done', 'failed', 'cancelled', 'waiting', 'blocked']);
  await new Promise(r => { const i = setInterval(() => { const x = office.tickets.get(t.id); if (x && done.has(x.state) && !office.running.size) { clearInterval(i); r(); } }, 500); });
  const x = office.tickets.get(t.id); office.stop();
  console.log(`\n[${x.state}] ${x.title} · ${office.company.agent(x.agent)?.name} · ${x.lane}/${x.engine}/${x.model} · ${Math.round((x.timings.totalMs || 0) / 1000)}s (boot ${Math.round((x.timings.bootMs || 0) / 1000)}s) · $${x.costUsd} (est $${x.estUsd})\n`);
  console.log(x.state === 'waiting' ? x.draft : x.result || x.error);
  process.exit(0);
} else if (cmd === 'tickets') {
  const office = new Office(cfg);
  for (const t of office.tickets.all({ state: rest[0] ? rest[0].split(',') : undefined }).slice(0, 50)) console.log(`${t.id}  ${t.state.padEnd(9)} ${(t.agent || '').padEnd(8)} ${t.title.slice(0, 70)}  ${t.lane || ''} $${t.costUsd}`);
} else if (cmd === 'ledger') {
  const office = new Office(cfg);
  for (const d of office.ledger.days(+rest[0] || 7)) console.log(`${d.day}  $${d.usd.toFixed(3)} api (est $${d.estUsd.toFixed(3)} all)  ${d.runs} runs  ` + Object.entries(d.byAgent).map(([a, v]) => `${a} $${v}`).join(', '));
} else if (cmd === 'routines') {
  const office = new Office(cfg);
  for (const r of office.routines.view()) console.log(`${r.id.padEnd(16)} ${r.whenText.padEnd(16)} ${r.agent.padEnd(7)} ${r.paused ? 'PAUSED ' : ''}${r.needsOk ? 'needs OK ' : ''}${r.title}  (last ${r.lastSlot || 'never'})`);
} else if (cmd === 'connect') {
  const what = rest[0];
  if (what === 'meta') {
    const { connectMeta, SCOPES } = await import('../io/connect-meta.mjs');
    const { loadSecrets } = await import('../core/secrets.mjs'); loadSecrets(cfg.secretsFile);
    console.log(`Signing in to Meta for: ${SCOPES.join(', ')}. The browser opens; press Continue. The token is written to the secrets file.`);
    try { const r = await connectMeta({ cfg }); console.log('done:', JSON.stringify(r)); process.exit(0); } catch (e) { console.error('failed:', e.message); process.exit(1); }
  } else if (what === 'mcp') {
    const key = rest[1]; const office = new Office(cfg); const c = office.connectors.get(key);
    if (!c || !c.url) { console.error(`nightdesk connect mcp <key>: a remote (http or sse) connector from the registry; got ${key || 'nothing'}`); process.exit(2); }
    const bin = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    const r = spawnSync(bin, ['mcp', 'add', '--transport', c.type === 'sse' ? 'sse' : 'http', key, c.url, '-s', 'user', ...(rest.includes('--client-id') ? ['--client-id', rest[rest.indexOf('--client-id') + 1]] : [])], { encoding: 'utf8', shell: process.platform === 'win32' });
    console.log((r.stdout || '') + (r.stderr || ''));
    console.log(`Now sign in once: open a terminal in this folder, run claude, type /mcp, pick ${key}, Authenticate, allow in the browser. The office reuses that sign-in; node bin/nightdesk.mjs check --connect ${key} confirms it.`);
    process.exit(r.status || 0);
  } else if (what === 'google') {
    const office = new Office(cfg); const g = await import('../io/connect-google.mjs');
    if (rest.includes('--enable')) {
      const r = await g.enable(office);
      console.log(`${r.account ? 'signed in as ' + r.account + '\n' : ''}on: ${r.enabled.join(', ') || 'none'}\n${r.skipped.length ? 'not on:\n  ' + r.skipped.join('\n  ') + '\n' : ''}${r.desks.length ? 'desks: ' + r.desks.join(', ') : ''}`);
      process.exit(r.enabled.length ? 0 : 1);
    }
    const clientId = secret('GOOGLE_OAUTH_CLIENT_ID'), clientSecret = secret('GOOGLE_OAUTH_CLIENT_SECRET');
    if (!clientId || !clientSecret) { console.error('Put GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in the secrets file first (the OAuth client made in Google Cloud, with http://127.0.0.1:8765/callback as a redirect URI).'); process.exit(2); }
    const gone = g.removePreview(); if (gone.length) console.log(`google: took Google's preview servers out of Claude Code (${gone.join(', ')}): they need a paid Workspace account; the office uses its own connector`);
    const account = cfg.google?.account || '';
    console.log(`google: a browser window opens. Pick ${account || 'the office account'}. Google warns that it has not checked the app (it is the office's own): press Advanced, then Go to the app. Tick every box and press Continue.\ngoogle: the app must be published in Google Cloud (Audience: In production), or Google ends this sign-in after 7 days.`);
    // exit by letting the process wind down (a hard exit straight after the sign-in server closes can trip
    // a libuv assertion on Windows); a stuck handle still ends it after a few seconds
    const end = code => { process.exitCode = code; setTimeout(() => process.exit(code), 8000).unref(); };
    try { const r = await g.connectGoogle({ cfg, clientId, clientSecret }); console.log(`google: allowed ${r.services.join(', ') || 'nothing'}${r.missing.length ? '; not allowed ' + r.missing.join(', ') : ''}\nNext: node bin/nightdesk.mjs connect google --enable`); end(0); }
    catch (e) { console.error('google: ' + e.message); end(1); }
  } else { console.error('nightdesk connect meta | connect mcp <key> | connect google [--enable]'); process.exit(2); }
} else { console.error('nightdesk demo [--show] | serve | check | run "<task>" | tickets [state] | ledger [days] | routines | connect meta|mcp|google'); process.exit(2); }
