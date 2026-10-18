#!/usr/bin/env node
// The office's own Google connector (MCP over stdio): Drive, Docs, Sheets and Calendar through Google's
// normal APIs, signed in once as the office account (node bin/nightdesk.mjs connect google). Works with a plain
// Gmail account: no Workspace subscription and no preview programme. The registry starts one process per
// service so each desk gets only what it is given:
//   node servers/google.mjs drive | docs | sheets | calendar   (several may be named; none means all)
// Secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN, read from the
// secrets file named in OFFICE_SECRETS_FILE (the environment wins). Office time: OFFICE_TZ.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Google, SERVICES } from '../io/google-api.mjs';
import { loadSecrets, secret } from '../core/secrets.mjs';
import { buildServer } from './google-tools.mjs';

const asked = process.argv.slice(2).filter(a => !a.startsWith('-'));
const unknown = asked.filter(s => !SERVICES[s]);
if (unknown.length) { console.error(`unknown service ${unknown.join(', ')}; use ${Object.keys(SERVICES).join(', ')}`); process.exit(2); }
const services = asked.length ? [...new Set(asked)] : Object.keys(SERVICES);
loadSecrets(process.env.OFFICE_SECRETS_FILE || '');
const google = new Google({ clientId: secret('GOOGLE_OAUTH_CLIENT_ID'), clientSecret: secret('GOOGLE_OAUTH_CLIENT_SECRET'), refreshToken: secret('GOOGLE_REFRESH_TOKEN') });
const server = buildServer({ google, services, tz: process.env.OFFICE_TZ || 'Europe/London' });
await server.connect(new StdioServerTransport());
