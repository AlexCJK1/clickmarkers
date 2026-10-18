// Google for the desks, through the office's own connector (servers/google.mjs) and Google's normal
// APIs. One sign-in in the owner's browser as the office account; the code is exchanged here (with
// PKCE) for a lasting sign-in, written straight into the secrets file as GOOGLE_REFRESH_TOKEN. Nothing
// to paste. Needs the OAuth client made in Google Cloud (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET)
// with http://127.0.0.1:8765/callback among its redirect URIs, and cfg.google.account naming the only
// account the office may use.
//
//   nightdesk connect google            sign in (a browser window opens)
//   nightdesk connect google --enable   check each service against Google, switch on the ones that work and
//                                put them on the desks below
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { AUTH_URL, TOKEN_URL, SERVICES, allScopes, Google, GoogleError, explain } from './google-api.mjs';
import { writeSecret } from './connect-meta.mjs';
import { page } from './office-page.mjs';
import { secret, redact } from '../core/secrets.mjs';

export const KEYS = ['google-drive', 'google-docs', 'google-sheets', 'google-calendar'];
export const SERVICE_OF = { 'google-drive': 'drive', 'google-docs': 'docs', 'google-sheets': 'sheets', 'google-calendar': 'calendar' };
/** Which desks get which Google service once it works. */
export const DESKS = {
  'google-drive': ['cos', 'report', 'dash', 'alead', 'invo', 'recon'],
  'google-docs': ['cos', 'report'],
  'google-sheets': ['dash', 'report', 'alead', 'invo', 'recon'],
  'google-calendar': ['cos'],
};

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The Google sign-in link (offline access, a fresh consent so a lasting sign-in comes back, PKCE). */
export function authLink({ clientId, redirect, state, challenge, account = '' }) {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: allScopes().join(' '), access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256', ...(account ? { login_hint: account } : {}) }).toString();
  return u.toString();
}
/** The email inside an ID token straight from Google's token endpoint ('' when absent or unverified). */
export function idEmail(idToken) {
  try { const p = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')); return p.email_verified === false ? '' : String(p.email || '').toLowerCase(); } catch { return ''; }
}
/** Which services a granted scope string covers. */
export function grantedServices(scope = '') { const have = new Set(String(scope).split(/\s+/)); return Object.keys(SERVICES).filter(s => have.has(SERVICES[s].scope)); }

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url.replace(/&/g, '^&')], { detached: true, stdio: 'ignore' }).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {}
}
const stateFile = cfg => path.join(cfg.data, 'google.json');
export function readState(cfg) { try { return JSON.parse(fs.readFileSync(stateFile(cfg), 'utf8')); } catch { return {}; } }
function saveState(cfg, s) { fs.mkdirSync(cfg.data, { recursive: true }); fs.writeFileSync(stateFile(cfg), JSON.stringify(s, null, 1) + '\n'); }

/**
 * The sign-in. Resolves to { account, services, missing } once the lasting sign-in is saved; rejects in
 * plain words. A request with the wrong state is answered and ignored (the sign-in keeps waiting).
 */
export function connectGoogle({ cfg, clientId, clientSecret, account = cfg.google?.account || '', port = cfg.google?.callbackPort ?? 8765, host = '127.0.0.1', open = true, log = console.log, fetchImpl = globalThis.fetch, timeoutMs = 10 * 60000, onListen = null }) {
  if (!clientId || !clientSecret) return Promise.reject(new GoogleError('GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are needed in the secrets file.', { kind: 'client' }));
  if (!cfg.secretsFile) return Promise.reject(new GoogleError('No secrets file is set (office.config.local.json, "secretsFile"): the sign-in would have nowhere to go.', { kind: 'config' }));
  const want = String(account || '').toLowerCase();
  const state = b64url(randomBytes(18)); const verifier = b64url(randomBytes(48)); const challenge = b64url(createHash('sha256').update(verifier).digest());
  return new Promise((resolve, reject) => {
    let done = false, busy = false, redirect = '';
    const office = cfg.port ? `http://${cfg.host && cfg.host !== '0.0.0.0' ? cfg.host : '127.0.0.1'}:${cfg.port}/` : '';
    // Settled only once the sign-in server is fully shut (on Windows, exiting while it is still closing
    // trips a libuv assertion after a sign-in that worked).
    const finish = (err, val) => {
      if (done) return; done = true; clearTimeout(timer);
      setTimeout(() => { server.closeAllConnections?.(); server.close(() => (err ? reject(err) : resolve(val))); }, 300);
    };
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, `http://${host}`);
      if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      if (u.searchParams.get('state') !== state) { page(res, 'Not this sign-in', 'This page is not from the sign-in that is running now. Close it and use the window the office opened.'); return; }
      if (done || busy) { page(res, done ? 'Already finished' : 'Finishing', done ? 'This sign-in has finished. You can close this tab.' : 'The sign-in is being finished in the other tab. You can close this one.'); return; }
      busy = true; // one exchange per sign-in: a second callback (a double click, a reload) waits on the first
      try {
        const err = u.searchParams.get('error');
        if (err) throw new GoogleError(err === 'access_denied' ? 'The sign-in was cancelled on Google\'s page. Nothing was saved.' : `Google said: ${err}. Nothing was saved.`, { kind: 'denied' });
        const code = u.searchParams.get('code'); if (!code) throw new GoogleError('Google sent no code back. Nothing was saved.');
        let r;
        try { r = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }).toString() }); }
        catch { throw new GoogleError('Could not reach Google to finish the sign-in. Nothing was saved.', { kind: 'network' }); }
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.access_token) {
          if (j.error === 'invalid_client' || j.error === 'unauthorized_client') throw new GoogleError('Google does not accept the OAuth client in the secrets file (GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET). Nothing was saved.', { kind: 'client' });
          if (j.error === 'invalid_grant') throw new GoogleError('That sign-in code was already used or ran out. Nothing was saved. Run it again.', { kind: 'code' });
          throw explain(r.status, j);
        }
        const email = idEmail(j.id_token);
        if (want && email !== want) throw new GoogleError(`You signed in as ${email || 'an account Google did not name'}, but the office must use ${want}. Nothing was saved. Run it again and pick ${want}.`, { kind: 'account' });
        if (!j.refresh_token) throw new GoogleError('Google did not hand back a lasting sign-in. As the office account, open https://myaccount.google.com/permissions, remove this app, then run this again.', { kind: 'refresh' });
        const services = grantedServices(j.scope); const missing = Object.keys(SERVICES).filter(s => !services.includes(s));
        writeSecret(cfg.secretsFile, 'GOOGLE_REFRESH_TOKEN', j.refresh_token);
        saveState(cfg, { account: email, services, at: Date.now() });
        page(res, 'Nightdesk is connected to Google', `Signed in as ${email}. Allowed: ${services.map(s => SERVICES[s].label).join(', ') || 'nothing'}.${missing.length ? ` Not allowed: ${missing.map(s => SERVICES[s].label).join(', ')} (run it again and tick those boxes if the desks need them).` : ''} You can close this tab.`, { office, ok: true });
        log(`google: signed in as ${email}; the lasting sign-in is saved to the secrets file as GOOGLE_REFRESH_TOKEN`);
        finish(null, { account: email, services, missing });
      } catch (e) {
        const msg = e instanceof GoogleError ? e.message : redact(String(e?.message || e));
        page(res, 'That did not work', msg, { office });
        finish(new GoogleError(msg, { kind: e?.kind || 'google' }));
      }
    });
    server.on('error', e => finish(new GoogleError(e.code === 'EADDRINUSE' ? `Port ${port} is in use on this PC (another sign-in window still open?). Close it and run this again.` : `Could not listen for the sign-in: ${e.message}`, { kind: 'port' })));
    server.listen(port, host, () => {
      redirect = `http://${host}:${server.address().port}/callback`;
      const url = authLink({ clientId, redirect, state, challenge, account: want });
      log(`google: waiting for the sign-in at ${redirect} (the OAuth client in Google Cloud must list exactly this under Authorised redirect URIs; if Google shows redirect_uri_mismatch, add it there and run this again)`);
      log(`google: if no browser window opened, open this:\n${url}`);
      if (open) openBrowser(url);
      onListen?.({ url, redirect, state });
    });
    const timer = setTimeout(() => finish(new GoogleError('Timed out waiting for the sign-in (10 minutes). Run it again.', { kind: 'timeout' })), timeoutMs);
    timer.unref?.();
  });
}

/** Ask Google whether each service works for the saved sign-in: { account, ok: [services], problems: { service: words } }. */
export async function checkServices(g, { account = '' } = {}) {
  const want = String(account || '').toLowerCase();
  const out = { account: '', ok: [], problems: {} };
  try { out.account = await g.whoami(); } catch (e) { for (const s of Object.keys(SERVICES)) out.problems[s] = e.message; return out; }
  if (want && out.account !== want) { for (const s of Object.keys(SERVICES)) out.problems[s] = `signed in as ${out.account}, but the office must use ${want}: run node bin/nightdesk.mjs connect google again`; return out; }
  const granted = new Set(g.granted || []);
  const probes = {
    drive: () => g.call('GET', 'https://www.googleapis.com/drive/v3/about', { service: 'drive', query: { fields: 'user(emailAddress)' } }),
    docs: () => g.call('GET', 'https://docs.googleapis.com/v1/documents/co-check-not-a-document', { service: 'docs', query: { fields: 'documentId' } }),
    sheets: () => g.call('GET', 'https://sheets.googleapis.com/v4/spreadsheets/co-check-not-a-spreadsheet', { service: 'sheets', query: { fields: 'spreadsheetId' } }),
    calendar: () => g.call('GET', 'https://www.googleapis.com/calendar/v3/calendars/primary/events', { service: 'calendar', query: { maxResults: 1, fields: 'items(id)' } }), // events.list: covered by calendar.events (calendars.get is not)
  };
  for (const s of Object.keys(SERVICES)) {
    if (g.granted && !granted.has(SERVICES[s].scope)) { out.problems[s] = `not allowed at the sign-in: run node bin/nightdesk.mjs connect google again and tick the ${SERVICES[s].label} box`; continue; }
    try { await probes[s](); out.ok.push(s); }
    catch (e) { if (['notfound', 'input'].includes(e.kind) && (s === 'docs' || s === 'sheets')) out.ok.push(s); else out.problems[s] = e.message; } // a made-up id: "not found" proves the API answers
  }
  return out;
}

/** Check each service against Google, switch on the ones that work (and that Claude Code can start),
 *  turn the rest off, and put the working ones on their desks. */
export async function enable(office, { keys = KEYS, desks = DESKS, fetchImpl, probe = true } = {}) {
  const report = { account: '', enabled: [], skipped: [], desks: [] };
  const g = new Google({ clientId: secret('GOOGLE_OAUTH_CLIENT_ID'), clientSecret: secret('GOOGLE_OAUTH_CLIENT_SECRET'), refreshToken: secret('GOOGLE_REFRESH_TOKEN'), ...(fetchImpl ? { fetchImpl } : {}) });
  if (!g.ready()) { report.skipped = keys.map(k => `${k}: not signed in yet (node bin/nightdesk.mjs connect google)`); return report; }
  const chk = await checkServices(g, { account: office.cfg.google?.account || '' });
  report.account = chk.account;
  const working = keys.filter(k => chk.ok.includes(SERVICE_OF[k]));
  for (const k of keys) if (!working.includes(k)) report.skipped.push(`${k}: ${chk.problems[SERVICE_OF[k]] || 'not checked'}`);
  const file = office.cfg.connectors; const read = () => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); const write = r => fs.writeFileSync(file, JSON.stringify(r, null, 1) + '\n');
  const reg = read(); for (const k of keys) if (reg[k]) reg[k].disabled = !working.includes(k);
  write(reg); office.connectors.load();
  let on = working;
  if (probe && working.length) {
    const view = await office.health_.probe(working); const health = Object.fromEntries(view.map(c => [c.key, c.health || {}]));
    on = working.filter(k => health[k]?.status === 'connected');
    for (const k of working) if (!on.includes(k)) report.skipped.push(`${k}: Google answers, but the connector did not start (${health[k]?.status || 'no status'}${health[k]?.note ? ': ' + health[k].note : ''})`);
    const after = read(); for (const k of keys) if (after[k]) { after[k].disabled = !on.includes(k); if (on.includes(k)) after[k].verified = true; }
    write(after); office.connectors.load();
  }
  report.enabled = on;
  for (const k of on) for (const id of desks[k] || []) { const a = office.company.agent(id); if (a && !(a.tools || []).includes(k)) { office.company.save(id, { tools: [...(a.tools || []), k] }); report.desks.push(`${id} + ${k}`); } }
  return report;
}

/** Take Google's preview servers (added earlier by this command) out of Claude Code's own setup. */
export function removePreview(keys = KEYS) {
  const bin = process.platform === 'win32' ? 'claude.cmd' : 'claude'; const shell = process.platform === 'win32'; const gone = [];
  for (const k of keys) {
    const r = spawnSync(bin, ['mcp', 'get', k], { encoding: 'utf8', shell });
    if (r.status === 0 && /mcp\.googleapis\.com\/mcp\/v1/.test(r.stdout || '')) {
      const d = spawnSync(bin, ['mcp', 'remove', k, '-s', 'user'], { encoding: 'utf8', shell });
      if (d.status === 0) gone.push(k);
    }
  }
  return gone;
}
