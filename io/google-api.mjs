// Google's own REST APIs (Drive, Docs, Sheets, Calendar) for the office's Google connector. Signed in
// once as the office account with the owner's OAuth client (nightdesk connect google); the refresh token lives
// in the secrets file and reaches only the connector process. No Google SDK: fetch, and a short-lived
// access token kept in memory. Every error comes back in plain words and never carries a token.
import { zonedTime } from '../core/clock.mjs';

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
export const SERVICES = {
  drive: { label: 'Google Drive', scope: 'https://www.googleapis.com/auth/drive', api: 'drive.googleapis.com' },
  docs: { label: 'Google Docs', scope: 'https://www.googleapis.com/auth/documents', api: 'docs.googleapis.com' },
  sheets: { label: 'Google Sheets', scope: 'https://www.googleapis.com/auth/spreadsheets', api: 'sheets.googleapis.com' },
  calendar: { label: 'Google Calendar', scope: 'https://www.googleapis.com/auth/calendar.events', api: 'calendar-json.googleapis.com' },
};
export const ID_SCOPES = ['openid', 'email'];
export const allScopes = () => [...ID_SCOPES, ...Object.values(SERVICES).map(s => s.scope)];
export const libraryLink = (api, project = '') => `https://console.cloud.google.com/apis/library/${api}${project ? '?project=' + encodeURIComponent(project) : ''}`;

export const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
/** Only Google's own console links are passed on to the desk. */
const safeLink = u => (/^https:\/\/console\.(developers|cloud)\.google\.com\/[^\s"'<>]*$/.test(String(u || '')) ? u : '');

export class GoogleError extends Error {
  constructor(message, { status = 0, kind = 'google' } = {}) { super(message); this.name = 'GoogleError'; this.status = status; this.kind = kind; }
}

/** Plain words for a Google error response (the parsed JSON body, or {}). */
export function explain(status, body = {}, service = '') {
  const e = body && typeof body.error === 'object' ? body.error : {};
  const msg = typeof body?.error === 'string' ? (body.error_description || body.error) : (e.message || '');
  const reasons = [...(e.errors || []).map(x => x?.reason), ...(e.details || []).map(d => d?.reason)].filter(Boolean);
  const info = (e.details || []).find(d => d?.metadata) || {};
  const svc = SERVICES[service] || Object.values(SERVICES).find(s => s.api === info.metadata?.service) || null;
  const label = svc ? `the ${svc.label} API` : 'this Google API';
  if (reasons.includes('SERVICE_DISABLED') || reasons.includes('accessNotConfigured') || /has not been used in project|it is disabled/i.test(msg)) {
    const link = safeLink(info.metadata?.activationUrl) || (svc ? libraryLink(svc.api, String(info.metadata?.consumer || '').replace(/^projects\//, '')) : '');
    return new GoogleError(`${cap(label)} is switched off in the Google Cloud project. Switch it on${link ? ` here: ${link}` : ' in the Cloud console (APIs and services, Library)'}, wait a minute, then try again.`, { status, kind: 'disabled' });
  }
  if (reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') || reasons.includes('insufficientPermissions') || /insufficient authentication scopes/i.test(msg)) {
    return new GoogleError(`The office was not given permission for ${svc ? svc.label : 'this'} when it signed in. Run node bin/nightdesk.mjs connect google again and tick every box on Google's permission page.`, { status, kind: 'scope' });
  }
  if (status === 404 || reasons.includes('notFound')) return new GoogleError('Not found. Check the id: the office account sees only its own files and files shared with it.', { status, kind: 'notfound' });
  if (status === 429 || reasons.some(r => /rateLimit|RATE_LIMIT|quota/i.test(r))) return new GoogleError('Google says too many requests just now. Wait a minute and try again.', { status, kind: 'rate' });
  if (status === 403) return new GoogleError(`The office account is not allowed to do that on this item${msg ? ` (${clip(msg, 200)})` : ''}.`, { status, kind: 'forbidden' });
  return new GoogleError(`${svc ? svc.label : 'Google'} said no (${status || 'error'})${msg ? `: ${clip(msg, 300)}` : ''}.`, { status, kind: status === 400 ? 'input' : 'google' });
}

/** A Google client for one refresh token. fetchImpl and now are for the tests. */
export class Google {
  constructor({ clientId = '', clientSecret = '', refreshToken = '', fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 60000 } = {}) {
    Object.assign(this, { clientId, clientSecret, refreshToken, fetchImpl, now, timeoutMs });
    this.access = ''; this.exp = 0; this.granted = null; this.pending = null;
  }
  ready() { return !!(this.clientId && this.clientSecret && this.refreshToken); }
  signal() { return typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(this.timeoutMs) : undefined; }

  /** A live access token (refreshed a minute before it runs out; one refresh at a time). */
  async token(force = false) {
    if (!this.ready()) throw new GoogleError('The office is not signed in to Google yet: run node bin/nightdesk.mjs connect google on the PC.', { kind: 'signed-out' });
    if (!force && this.access && this.now() < this.exp - 60000) return this.access;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      let res;
      try { res = await this.fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, refresh_token: this.refreshToken, grant_type: 'refresh_token' }).toString(), signal: this.signal() }); }
      catch (e) { throw new GoogleError(`Could not reach Google to sign in (${e?.name === 'TimeoutError' ? 'timed out' : 'network'}).`, { kind: 'network' }); }
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.access_token) {
        if (j.error === 'invalid_grant') throw new GoogleError('The Google sign-in has expired or was taken back. Run node bin/nightdesk.mjs connect google on the PC and sign in as the office account again. If it expires every 7 days, the app in Google Cloud is still in Testing: publish it (Google Auth Platform, Audience, Publish app).', { status: res.status, kind: 'signed-out' });
        if (j.error === 'invalid_client' || j.error === 'unauthorized_client') throw new GoogleError('Google does not accept the OAuth client in the secrets file (GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET). Check both against the client in Google Cloud.', { status: res.status, kind: 'client' });
        throw explain(res.status, j);
      }
      this.access = j.access_token; this.exp = this.now() + (+j.expires_in || 3600) * 1000;
      if (j.scope) this.granted = String(j.scope).split(/\s+/);
      return this.access;
    })().finally(() => { this.pending = null; });
    return this.pending;
  }

  /** One API call. query: URL parameters; json: a JSON body; body + contentType: a raw body; as: 'json' | 'text'.
   *  A 401 is retried once with a fresh token. Errors are GoogleErrors in plain words. */
  async call(method, url, { query, json, body, contentType, as = 'json', service = '' } = {}) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      const headers = { authorization: `Bearer ${await this.token(attempt > 0)}` };
      let b = body;
      if (json !== undefined) { headers['content-type'] = 'application/json'; b = JSON.stringify(json); } else if (contentType) headers['content-type'] = contentType;
      let res;
      try { res = await this.fetchImpl(u.toString(), { method, headers, body: b, signal: this.signal() }); }
      catch (e) { throw new GoogleError(`Could not reach ${SERVICES[service]?.label || 'Google'} (${e?.name === 'TimeoutError' ? 'timed out' : 'network'}).`, { kind: 'network' }); }
      if (res.status === 401 && attempt === 0) { this.access = ''; continue; }
      if (!res.ok) { const t = await res.text().catch(() => ''); let j = {}; try { j = JSON.parse(t); } catch {} throw explain(res.status, j, service); }
      if (res.status === 204) return as === 'text' ? '' : {};
      return as === 'text' ? res.text() : res.json();
    }
  }

  /** The signed-in account's email (openid userinfo). */
  async whoami() { const j = await this.call('GET', USERINFO_URL); return String(j.email || '').toLowerCase(); }
}

/**
 * An RFC 3339 instant from what a desk writes. A full ISO time with Z or an offset stays as it is;
 * "2026-10-13T09:00" or "2026-10-13 09:00" is the office's wall clock in tz; "2026-10-13" is midnight there.
 */
export function toInstant(s, tz = 'Europe/London') {
  const str = String(s ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(str)) {
    const t = Date.parse(str); if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2})?)?$/);
  const bad = () => new GoogleError(`Not a time I can read: "${clip(str, 40)}". Write 2026-10-13T09:00 (office time) or a full ISO time.`, { kind: 'input' });
  if (!m) throw bad();
  const [y, mo, d, hh, mm] = [+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0)];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (mo < 1 || mo > 12 || d < 1 || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || hh > 23 || mm > 59) throw bad();
  return new Date(zonedTime(y, mo, d, hh, mm, tz)).toISOString();
}
