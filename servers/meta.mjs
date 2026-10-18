#!/usr/bin/env node
// The office's own Facebook Page and Instagram connector (MCP over stdio), through Meta's Graph API.
// Secrets: META_PAGE_TOKEN (a Page access token, docs/meta.md) and, if the Meta app requires it, META_APP_SECRET;
// read from the secrets file named in OFFICE_SECRETS_FILE (the environment wins). Pictures only from the media
// folders in OFFICE_MEDIA_ROOTS. Office time: OFFICE_TZ.
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadSecrets, secret } from '../core/secrets.mjs';
import { Graph, buildServer } from './meta-tools.mjs';

loadSecrets(process.env.OFFICE_SECRETS_FILE || '');
const graph = new Graph({ token: secret('META_PAGE_TOKEN'), appSecret: secret('META_APP_SECRET') });
const roots = String(process.env.OFFICE_MEDIA_ROOTS || '')
  .split(path.delimiter)
  .filter(Boolean);
const server = buildServer({ graph, roots, tz: process.env.OFFICE_TZ || 'Europe/London' });
await server.connect(new StdioServerTransport());
