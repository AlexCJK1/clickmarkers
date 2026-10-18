#!/usr/bin/env node
// The office's own mailbox server (MCP over stdio): IMAP for reading and drafting, SMTP for sending.
// Works with any mailbox that has IMAP and an app password (Gmail: 2-step verification → App passwords).
// No Google Cloud project, no OAuth. Secrets: MAIL_USER, MAIL_APP_PASSWORD (and optional MAIL_IMAP_HOST,
// MAIL_SMTP_HOST, default Gmail). mail_send is outbound: the office refuses it in the draft phase.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { draftMessage, checkHeaders, checkRecipients } from './mail-message.mjs';
import fs from 'node:fs';

function secrets() {
  const out = {};
  const f = process.env.OFFICE_SECRETS_FILE;
  if (f) {
    try {
      for (const raw of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
        const l = raw.replace(/^﻿/, '').trim();
        if (!l || l.startsWith('#')) continue;
        const i = l.indexOf('=');
        if (i > 0)
          out[l.slice(0, i).trim()] = l
            .slice(i + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
      }
    } catch {
      // no secrets file: the settings come from the environment
    }
  }
  for (const k of ['MAIL_USER', 'MAIL_APP_PASSWORD', 'MAIL_IMAP_HOST', 'MAIL_SMTP_HOST'])
    if (process.env[k]) out[k] = process.env[k];
  return out;
}
const S = secrets();
const USER = S.MAIL_USER,
  PASS = S.MAIL_APP_PASSWORD;
const IMAP_HOST = S.MAIL_IMAP_HOST || 'imap.gmail.com',
  SMTP_HOST = S.MAIL_SMTP_HOST || 'smtp.gmail.com';
const text = s => ({ content: [{ type: 'text', text: String(s) }] });
const clip = (s, n) => {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
};

async function withImap(fn) {
  if (!USER || !PASS) throw new Error('MAIL_USER and MAIL_APP_PASSWORD are not set');
  const c = new ImapFlow({
    host: IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: USER, pass: PASS },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 60000,
  });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    try {
      await c.logout();
    } catch {
      // the server already closed the connection
    }
  }
}
const head = m => ({
  uid: m.uid,
  date: m.envelope?.date,
  from: (m.envelope?.from || []).map(a => `${a.name || ''} <${a.address}>`).join(', '),
  to: (m.envelope?.to || []).map(a => a.address).join(', '),
  subject: m.envelope?.subject || '',
  flags: [...(m.flags || [])],
  size: m.size,
});

const server = new McpServer(
  { name: 'mail', version: '1.0.0' },
  { instructions: `The ${USER || 'office'} mailbox over IMAP. Read, search and draft; sending waits for the owner.` },
);

server.tool(
  'mail_folders',
  'List the mailbox folders (Gmail labels appear as folders, e.g. "[Gmail]/Drafts", "Social").',
  {},
  async () =>
    withImap(async c =>
      text((await c.list()).map(f => `${f.path}${f.specialUse ? ' (' + f.specialUse + ')' : ''}`).join('\n')),
    ),
);

server.tool(
  'mail_list',
  'The newest messages in a folder (default INBOX), headers only.',
  { folder: z.string().optional(), n: z.number().optional() },
  async ({ folder = 'INBOX', n = 20 }) =>
    withImap(async c => {
      const lock = await c.getMailboxLock(folder);
      try {
        const total = c.mailbox.exists;
        if (!total) return text('(empty)');
        const from = Math.max(1, total - n + 1);
        const rows = [];
        for await (const m of c.fetch(`${from}:*`, { uid: true, envelope: true, flags: true, size: true }))
          rows.push(head(m));
        return text(
          rows
            .reverse()
            .map(
              r =>
                `uid ${r.uid} · ${r.date ? new Date(r.date).toISOString().slice(0, 16) : ''} · ${r.from} · ${r.subject}${r.flags.includes('\\Seen') ? '' : ' · UNREAD'}`,
            )
            .join('\n'),
        );
      } finally {
        lock.release();
      }
    }),
);

server.tool(
  'mail_search',
  'Search a folder: free text, and/or from, subject, newer than N days, unread only; or raw Gmail search syntax in "gmail" (e.g. "category:social newer_than:1d", "from:facebookmail.com"). Headers only; read one with mail_read.',
  {
    query: z.string().optional(),
    from: z.string().optional(),
    subject: z.string().optional(),
    days: z.number().optional(),
    unread: z.boolean().optional(),
    gmail: z.string().optional(),
    folder: z.string().optional(),
    max: z.number().optional(),
  },
  async ({ query, from, subject, days = 7, unread, gmail, folder = 'INBOX', max = 30 }) =>
    withImap(async c => {
      const lock = await c.getMailboxLock(gmail && folder === 'INBOX' ? '[Gmail]/All Mail' : folder);
      try {
        const q = gmail ? { gmraw: gmail } : { since: new Date(Date.now() - days * 86400000) };
        if (query) q.text = query;
        if (from) q.from = from;
        if (subject) q.subject = subject;
        if (unread) q.seen = false;
        const uids = await c.search(q, { uid: true });
        if (!uids.length) return text('No messages match.');
        const rows = [];
        for await (const m of c.fetch(
          uids.slice(-max),
          { uid: true, envelope: true, flags: true, size: true },
          { uid: true },
        ))
          rows.push(head(m));
        return text(
          rows
            .reverse()
            .map(
              r =>
                `uid ${r.uid} · ${r.date ? new Date(r.date).toISOString().slice(0, 16) : ''} · ${r.from} · ${r.subject}${r.flags.includes('\\Seen') ? '' : ' · UNREAD'}`,
            )
            .join('\n'),
        );
      } finally {
        lock.release();
      }
    }),
);

server.tool(
  'mail_read',
  'Read one message by uid (text body, attachments listed, not downloaded). Up to 20,000 characters.',
  { uid: z.number(), folder: z.string().optional() },
  async ({ uid, folder = 'INBOX' }) =>
    withImap(async c => {
      const lock = await c.getMailboxLock(folder);
      try {
        const m = await c.fetchOne(String(uid), { uid: true, source: true, envelope: true }, { uid: true });
        if (!m) return text(`No message with uid ${uid} in ${folder}.`);
        const p = await simpleParser(m.source);
        const body =
          (p.text || '').trim() ||
          (p.html || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return text(
          `From: ${p.from?.text || ''}\nTo: ${p.to?.text || ''}\nDate: ${p.date ? p.date.toISOString() : ''}\nSubject: ${p.subject || ''}\n${(p.attachments || []).length ? 'Attachments: ' + p.attachments.map(a => `${a.filename} (${a.size} bytes)`).join(', ') + '\n' : ''}\n${clip(body, 20000)}`,
        );
      } finally {
        lock.release();
      }
    }),
);

server.tool(
  'mail_draft',
  'Save a draft in the Drafts folder for the owner to review and send. Not sent.',
  { to: z.string(), subject: z.string(), body: z.string(), inReplyTo: z.string().optional() },
  async ({ to, subject, body, inReplyTo }) =>
    withImap(async c => {
      const raw = await draftMessage({ from: USER, to, subject, body, inReplyTo }); // built by nodemailer: no header can be smuggled in
      const drafts = (await c.list()).find(f => f.specialUse === '\\Drafts')?.path || 'Drafts';
      const r = await c.append(drafts, raw, ['\\Draft']);
      return text(`Draft saved in ${drafts}${r?.uid ? ` (uid ${r.uid})` : ''}. The owner sends it.`);
    }),
);

server.tool(
  'mail_send',
  'Send an email from the mailbox (outbound: only after the owner has approved the draft).',
  { to: z.string(), subject: z.string(), body: z.string(), inReplyTo: z.string().optional() },
  async ({ to, subject, body, inReplyTo }) => {
    if (!USER || !PASS) throw new Error('MAIL_USER and MAIL_APP_PASSWORD are not set');
    checkHeaders({ to, subject, inReplyTo });
    checkRecipients(to);
    const t = nodemailer.createTransport({
      host: SMTP_HOST,
      port: 465,
      secure: true,
      auth: { user: USER, pass: PASS },
    });
    const r = await t.sendMail({
      from: USER,
      to,
      subject,
      text: body,
      ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
    });
    return text(`Sent to ${to}: ${r.messageId}`);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
