// Connect Meta: Facebook Login for Business in the owner's browser, the code exchanged here for a
// long-lived user token with the Ads MCP permission, written straight into the secrets file as
// META_MCP_TOKEN, and the token of the Facebook Page the office posts on (the only Page, or the one named
// with --page) as META_PAGE_TOKEN. One click for the owner (Continue as …); nothing to paste.
// Needs META_APP_ID and META_APP_SECRET in the secrets, and the redirect URI below listed under the
// app's Facebook Login for Business → Settings → Valid OAuth Redirect URIs.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { secret, redact } from '../core/secrets.mjs';
import { page as officePage } from './office-page.mjs';

const GRAPH = 'https://graph.facebook.com/v23.0';
export const SCOPES = ['ads_mcp_management', 'ads_read', 'ads_management', 'business_management', 'pages_show_list'];
/** What posting on the Page and its Instagram account needs, asked for in the same sign-in (not with --ads-only). */
export const PAGE_SCOPES = [
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
];
const q = o => new URLSearchParams(o).toString(); // every value encoded: a code or a token can hold & or #

/**
 * The Page the office posts on, from the person's long-lived token: the one named (by id or name), or the only one.
 * A Page token made from a long-lived person's token does not expire. Returns { pages: [{id, name}], page }.
 */
export async function pageToken(userToken, want = '', { fetch: f = fetch } = {}) {
  const r = await (
    await f(`${GRAPH}/me/accounts?${q({ fields: 'id,name,access_token', limit: 100, access_token: userToken })}`)
  ).json();
  if (r.error) throw new Error(`pages: ${r.error.message || JSON.stringify(r.error)}`);
  const pages = (r.data || []).map(p => ({ id: String(p.id), name: String(p.name || ''), token: p.access_token }));
  const w = String(want || '')
    .trim()
    .toLowerCase();
  const pick = w ? pages.filter(p => p.id === w || p.name.toLowerCase() === w) : pages.length === 1 ? pages : [];
  return {
    pages: pages.map(({ id, name }) => ({ id, name })),
    page: pick.length === 1 && pick[0].token ? pick[0] : null,
  };
}

export function writeSecret(file, name, value) {
  let lines = [];
  try {
    lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  } catch {
    // no secrets file yet: it is created
  }
  const i = lines.findIndex(l =>
    l
      .replace(/^﻿/, '')
      .trim()
      .startsWith(name + '='),
  );
  const line = `${name}=${value}`;
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (i >= 0) lines[i] = line;
  else lines.push(line);
  // A whole new file first (in the system temp folder, never beside the secrets file in a repo), then
  // swapped in: a crash half-way never leaves a cut-off secrets file. Windows may hold the file for a
  // moment while the office reads it, so the swap is tried a few times.
  const tmp = path.join(os.tmpdir(), `cm-secrets-${process.pid}-${Date.now()}`);
  let target = file;
  try {
    target = fs.realpathSync(file);
  } catch {
    // a linked secrets file is written through, not replaced
  }
  fs.writeFileSync(tmp, lines.join('\n') + '\n', { mode: 0o600 });
  try {
    for (let i = 0; ; i++) {
      try {
        fs.renameSync(tmp, target);
        return;
      } catch (e) {
        if (e.code === 'EXDEV') {
          fs.copyFileSync(tmp, target);
          return;
        }
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || i >= 5) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      }
    }
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // the temporary copy is already gone
    }
  }
}

export function connectMeta({ cfg, port = 4621, open = true, log = console.log, page: want = '', adsOnly = false }) {
  const appId = secret('META_APP_ID'),
    appSecret = secret('META_APP_SECRET');
  if (!appId || !appSecret) throw new Error('META_APP_ID and META_APP_SECRET are needed in the secrets file');
  const redirect = `http://localhost:${port}/meta/callback`;
  const state = randomBytes(12).toString('hex');
  const url = `https://www.facebook.com/v23.0/dialog/oauth?${new URLSearchParams({ client_id: appId, redirect_uri: redirect, state, scope: (adsOnly ? SCOPES : [...SCOPES, ...PAGE_SCOPES]).join(','), response_type: 'code' })}`;
  let server;
  const done = new Promise((resolve, reject) => {
    server = http.createServer(async (req, res) => {
      const u = new URL(req.url, `http://localhost:${port}`);
      if (u.pathname !== '/meta/callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      const page = (title, body) =>
        officePage(res, title, body, {
          office: cfg.port ? `http://127.0.0.1:${cfg.port}/` : '',
          ok: !/did not work/.test(title),
        });
      // a hit without this sign-in's state (another page, a stale tab) is turned away and the sign-in keeps waiting
      if (u.searchParams.get('state') !== state) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('This is not the sign-in the office started. Use the window it opened.');
        return;
      }
      try {
        if (u.searchParams.get('error'))
          throw new Error(`${u.searchParams.get('error')}: ${u.searchParams.get('error_description') || ''}`);
        const code = u.searchParams.get('code');
        if (!code) throw new Error('no code');
        const r1 = await (
          await fetch(
            `${GRAPH}/oauth/access_token?${q({ client_id: appId, redirect_uri: redirect, client_secret: appSecret, code })}`,
          )
        ).json();
        if (!r1.access_token) throw new Error(`exchange: ${JSON.stringify(r1.error || r1)}`);
        const r2 = await (
          await fetch(
            `${GRAPH}/oauth/access_token?${q({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: r1.access_token })}`,
          )
        ).json();
        const token = r2.access_token || r1.access_token;
        const perms = await (await fetch(`${GRAPH}/me/permissions?${q({ access_token: token })}`)).json();
        const granted = (perms.data || []).filter(p => p.status === 'granted').map(p => p.permission);
        const missing = (adsOnly ? SCOPES : [...SCOPES, ...PAGE_SCOPES]).filter(s => !granted.includes(s));
        writeSecret(cfg.secretsFile, 'META_MCP_TOKEN', token);
        // the Page to post on: its own token, saved beside the person's
        let pageNote = '';
        let chosen = null;
        if (!adsOnly) {
          const pg = await pageToken(token, want);
          chosen = pg.page;
          if (chosen) {
            writeSecret(cfg.secretsFile, 'META_PAGE_TOKEN', chosen.token);
            pageNote = ` Posting on the Page ${chosen.name}.`;
          } else if (pg.pages.length)
            pageNote = ` ${want ? `No Page called ${want}. ` : ''}Pages on this login: ${pg.pages.map(p => p.name).join(', ')}. To post on one, run clickmarkers connect meta --page "<its name>".`;
          else pageNote = ' No Facebook Page on this login, so nothing can be posted yet.';
        }
        page(
          'Clickmarkers is connected to Meta',
          `Permissions granted: ${granted.join(', ')}.${missing.length ? ` Not granted: ${missing.join(', ')}.` : ''} Token ${r2.expires_in ? `valid about ${Math.round(r2.expires_in / 86400)} days` : 'saved'}.${pageNote} You can close this tab.`,
        );
        log(
          `meta: token saved to the secrets file as META_MCP_TOKEN (${granted.length} permissions${missing.length ? ', missing ' + missing.join(', ') : ''})${chosen ? `; META_PAGE_TOKEN for ${chosen.name}` : ''}.${pageNote && !chosen ? pageNote : ''}`,
        );
        setTimeout(() => {
          server.close();
          resolve({
            granted,
            missing,
            expiresIn: r2.expires_in || 0,
            page: chosen ? { id: chosen.id, name: chosen.name } : null,
          });
        }, 500);
      } catch (e) {
        page('That did not work', redact(e.message));
        setTimeout(() => {
          server.close();
          reject(new Error(redact(e.message)));
        }, 500);
      }
    });
    server.listen(port, '127.0.0.1', () => {
      log(`meta: waiting for the sign-in at ${redirect}`);
      log(`meta: open this in the browser if it did not open itself:\n${url}`);
      if (open) {
        try {
          if (process.platform === 'win32')
            spawn('cmd', ['/c', 'start', '', url.replace(/&/g, '^&')], { detached: true, stdio: 'ignore' }).unref();
          else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
        } catch {
          // no browser to open: the address is printed for the owner to open by hand
        }
      }
    });
    setTimeout(() => {
      server.close();
      reject(new Error('timed out waiting for the sign-in (10 minutes)'));
    }, 10 * 60000).unref();
  });
  done.server = server; // for the tests: the listener, to ask it things and close it
  return done;
}
