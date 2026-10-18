// The tools of the office's own Facebook Page and Instagram connector, through Meta's Graph API with a Page
// access token. Reading is free. page_post and ig_post publish: the registry lists them as outbound, so they run
// only after the owner's OK, and its "verbatim" list holds them to the words he approved. There is no delete tool.
// A picture comes from the office's media folders or from a public https link the approved draft names.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mediaPath } from '../core/media.mjs';
import { zonedTime } from '../core/clock.mjs';
import { fmtAt } from '../core/when.mjs';

export const VERSION = 'v25.0';
export const READS = ['social_accounts', 'page_posts', 'page_scheduled', 'ig_posts'];
export const WRITES = ['page_post', 'ig_post'];
const MAX_OUT = 40000;
const MAX_IMAGE = 8 * 1024 * 1024;
const MIN_AHEAD = 10 * 60000; // Facebook schedules from 10 minutes ahead
const MAX_AHEAD = 30 * 86400000; // to 30 days ahead
const LATE = 60 * 60000; // a time passed by more than this is a missed slot: nothing goes out (as the office does)
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

export class MetaError extends Error {
  constructor(message, kind = 'meta', status = 0) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}
export const clip = (s, n) => {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
};
const say = (m, kind = 'input') => {
  throw new MetaError(m, kind);
};

/** Meta's error, in words the owner can act on. */
export function explain(status, body = {}) {
  const e = body?.error || {};
  const code = +e.code || 0;
  const said = clip(e.error_user_msg || e.message || `HTTP ${status}`, 300);
  if (code === 190 || status === 401)
    return {
      kind: 'auth',
      text: `Meta refused the Page token (${said}). It has expired or was revoked: make a new one (docs/meta.md) and put it in META_PAGE_TOKEN.`,
    };
  if (code === 10 || (code >= 200 && code <= 299))
    return {
      kind: 'permission',
      text: `The Page token lacks a permission for this (${said}). It needs pages_show_list, pages_read_engagement and pages_manage_posts, and for Instagram also instagram_basic and instagram_content_publish (docs/meta.md).`,
    };
  if ([4, 9, 17, 32, 613, 80001].includes(code) || status === 429)
    return {
      kind: 'limit',
      text: `Meta says too many calls for now (${said}). Nothing more was sent; try again later.`,
    };
  if (code === 368) return { kind: 'meta', text: `Meta blocked this as against its rules (${said}).` };
  if (code === 100 || status === 400) return { kind: 'input', text: `Meta did not accept the request: ${said}` };
  return { kind: 'meta', text: `Meta answered with an error: ${said}` };
}

/** A Graph API client for one Page. The token travels in a header, never in a link, and never in an error. */
export class Graph {
  constructor({
    token = '',
    appSecret = '',
    version = VERSION,
    fetch: f = globalThis.fetch,
    timeoutMs = 60000,
    pollMs = 3000,
    pollTries = 20,
  } = {}) {
    Object.assign(this, { token, appSecret, version, fetch: f, timeoutMs, pollMs, pollTries });
  }
  scrub(s) {
    let out = String(s ?? '');
    for (const x of [this.token, this.appSecret]) if (x) out = out.split(x).join('[hidden]');
    return out;
  }
  async call(method, p, { query = {}, form = null, multipart = null } = {}) {
    if (!this.token)
      throw new MetaError(
        'META_PAGE_TOKEN is not set: make a Page token (docs/meta.md) and add it to the secrets file.',
        'auth',
      );
    const url = new URL(`https://graph.facebook.com/${this.version}/${String(p).replace(/^\/+/, '')}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    // if the Meta app asks for it, every call proves it knows the app secret (an HMAC of the token, not the secret)
    if (this.appSecret)
      url.searchParams.set(
        'appsecret_proof',
        crypto.createHmac('sha256', this.appSecret).update(this.token).digest('hex'),
      );
    let body;
    if (multipart) body = multipart;
    else if (form)
      body = new URLSearchParams(
        Object.entries(form)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => [k, String(v)]),
      );
    let res;
    try {
      res = await this.fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.token}` },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new MetaError(`Could not reach Meta: ${this.scrub(clip(e?.message || e, 200))}`, 'network');
    }
    const raw = await res.text();
    let json = {};
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      json = {};
    }
    if (!res.ok || json?.error) {
      const x = explain(res.status, json);
      throw new MetaError(this.scrub(x.text), x.kind, res.status);
    }
    return json;
  }
  /** The Page the token belongs to (a Page token's "me" is the Page). A person's token is named as the mistake. */
  async page() {
    if (this._page) return this._page;
    let me;
    try {
      me = await this.call('GET', 'me', { query: { fields: 'id,name,category' } });
    } catch (e) {
      if (e.kind === 'input' && /nonexisting field|category/i.test(e.message))
        throw new MetaError(
          "META_PAGE_TOKEN is a person's token, not a Page token. Make the Page token from it (docs/meta.md).",
          'auth',
        );
      throw e;
    }
    this._page = { id: String(me.id), name: me.name || 'the Page' };
    return this._page;
  }
  /** The Instagram professional account linked to the Page. */
  async instagram() {
    const p = await this.page();
    if (this._ig === undefined) {
      const r = await this.call('GET', p.id, { query: { fields: 'instagram_business_account{id,username}' } });
      this._ig = r.instagram_business_account
        ? { id: String(r.instagram_business_account.id), username: r.instagram_business_account.username || '' }
        : null;
    }
    if (!this._ig)
      throw new MetaError(
        `${p.name} has no Instagram professional account linked to it. Link one in Meta Business Suite (Settings, Linked accounts), then make the Page token again.`,
        'input',
      );
    return this._ig;
  }
  /**
   * A public link to a picture on this computer, for Instagram (which fetches pictures from the web and takes JPEG
   * only): the picture goes up to the Page unpublished, Facebook stores it as JPEG, and its largest copy's link is
   * handed on. It never shows on the Page; Facebook drops unpublished uploads after about a day.
   */
  async hostPicture(file) {
    const p = await this.page();
    const fd = new FormData();
    fd.set('published', 'false');
    fd.set('source', await fs.openAsBlob(file, { type: TYPES[path.extname(file).toLowerCase()] }), path.basename(file));
    const up = await this.call('POST', `${p.id}/photos`, { multipart: fd });
    const ph = await this.call('GET', String(up.id), { query: { fields: 'images' } });
    const best = [...(ph.images || [])].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    if (!best?.source)
      throw new MetaError('Facebook took the picture but gave no link Instagram could fetch it from.', 'meta');
    return best.source;
  }
  /** Wait for Instagram to take a picture in (a container), about a minute at most. */
  async ready(id) {
    for (let i = 0; i < this.pollTries; i++) {
      const s = await this.call('GET', String(id), { query: { fields: 'status_code,status' } });
      if (s.status_code === 'FINISHED') return;
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED')
        throw new MetaError(
          `Instagram could not take the picture (${clip(s.status || s.status_code, 200)}). Nothing was posted.`,
          'input',
        );
      if (s.status_code === 'PUBLISHED') return;
      await new Promise(r => setTimeout(r, this.pollMs));
    }
    throw new MetaError(
      'Instagram was still processing the picture after a minute. Nothing was posted; try again.',
      'meta',
    );
  }
}

/** A time a desk writes: 2026-10-22T18:00 or 2026-10-22 18:00 is office time; a full ISO time keeps its zone. */
export function whenOf(s, tz = 'Europe/London') {
  const str = String(s ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(str)) {
    const t = Date.parse(str);
    if (!Number.isNaN(t)) return t;
  }
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2})?$/);
  const [y, mo, d, hh, mm] = m ? m.slice(1).map(Number) : [];
  const check = m && new Date(Date.UTC(y, mo - 1, d));
  if (!m || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || hh > 23 || mm > 59)
    say(`Not a time I can read: "${clip(str, 40)}". Write 2026-10-22T18:00 (office time).`);
  return zonedTime(y, mo, d, hh, mm, tz);
}
const https = u => {
  let url;
  try {
    url = new URL(String(u));
  } catch {
    say(`Not a link: "${clip(u, 80)}".`);
  }
  if (url.protocol !== 'https:') say(`Only https links: "${clip(u, 80)}".`);
  return url.toString();
};

/**
 * The MCP server. graph: a Graph (or a stand-in in tests); roots: the media folders pictures may come from;
 * now: the clock (tests set it).
 */
export function buildServer({ graph: g, roots = [], tz = 'Europe/London', now = () => Date.now() } = {}) {
  const server = new McpServer(
    { name: 'meta-pages', version: '1.0.0' },
    {
      instructions: `The business's Facebook Page and the Instagram account linked to it. Reading is free; page_post and ig_post publish, so they run only after the owner's OK, with exactly the words he approved. Times without a zone are office time (${tz}).`,
    },
  );
  /** A picture in the media folders, by full path or by a path inside one of them. */
  const picture = f => {
    if (!roots.length)
      say(
        'No media folder is set, so no picture on this computer can be posted. Add one to media.roots in office.config.local.json, or use imageUrl.',
      );
    const m = mediaPath(f, roots);
    if (m.error) say(`${m.error[0].toUpperCase()}${m.error.slice(1)}.`);
    const real = m.real;
    if (!TYPES[path.extname(real).toLowerCase()])
      say(`${path.basename(real)}: only JPEG and PNG pictures can be posted.`);
    const st = fs.statSync(real);
    if (!st.isFile()) say(`${path.basename(real)} is not a file.`);
    const size = st.size;
    if (size > MAX_IMAGE)
      say(`${path.basename(real)} is ${(size / 1048576).toFixed(1)} MB; the limit here is 8 MB. Export it smaller.`);
    return real;
  };
  const add = (name, description, shape, fn) =>
    server.tool(
      name,
      description,
      shape,
      { readOnlyHint: READS.includes(name), destructiveHint: false, openWorldHint: WRITES.includes(name) },
      async args => {
        try {
          let out = String(await fn(args || {}));
          if (out.length > MAX_OUT) out = out.slice(0, MAX_OUT) + '\n… (cut here: ask for fewer)';
          return { content: [{ type: 'text', text: out }] };
        } catch (e) {
          const msg =
            e instanceof MetaError
              ? e.message
              : `Something went wrong: ${g.scrub ? g.scrub(clip(e?.message || e, 300)) : clip(e?.message || e, 300)}`;
          return { isError: true, content: [{ type: 'text', text: msg }] };
        }
      },
    );
  const n = z.number().int().min(1).max(50).optional();

  add(
    'social_accounts',
    'The Facebook Page this office posts to, the Instagram account linked to it, and how many of the 100 Instagram posts a day Meta allows are used.',
    {},
    async () => {
      const p = await g.page();
      let ig = '';
      try {
        const a = await g.instagram();
        ig = `Instagram: @${a.username} (id ${a.id})`;
        try {
          const q = (
            await g.call('GET', `${a.id}/content_publishing_limit`, { query: { fields: 'quota_usage,config' } })
          ).data?.[0];
          if (q) ig += ` · ${q.quota_usage ?? 0} of ${q.config?.quota_total ?? 100} posts used in the last 24 hours`;
        } catch {
          // the count is a nicety
        }
      } catch (e) {
        ig = `Instagram: ${e.message}`;
      }
      return `Facebook Page: ${p.name} (id ${p.id})\n${ig}`;
    },
  );

  add(
    'page_posts',
    'The newest posts on the Facebook Page (default 10): time, words, link.',
    { n },
    async ({ n = 10 }) => {
      const p = await g.page();
      const r = await g.call('GET', `${p.id}/posts`, {
        query: { fields: 'id,created_time,message,permalink_url', limit: n },
      });
      const rows = (r.data || []).map(
        x =>
          `${x.created_time ? fmtAt(Date.parse(x.created_time), tz) : ''} · ${clip(String(x.message || '(no words)').replace(/\s+/g, ' '), 200)} · ${x.permalink_url || x.id}`,
      );
      return rows.length ? rows.join('\n') : 'No posts on the Page yet.';
    },
  );

  add(
    'page_scheduled',
    'Posts booked on the Facebook Page for later, with their times. Use it to find a free slot.',
    {},
    async () => {
      const p = await g.page();
      const r = await g.call('GET', `${p.id}/scheduled_posts`, {
        query: { fields: 'id,message,scheduled_publish_time' },
      });
      const rows = (r.data || [])
        .map(x => ({ ...x, t: +x.scheduled_publish_time * 1000 || Date.parse(x.scheduled_publish_time) || 0 }))
        .sort((a, b) => a.t - b.t)
        .map(
          x =>
            `${x.t ? fmtAt(x.t, tz) : '?'} · ${clip(String(x.message || '(picture)').replace(/\s+/g, ' '), 200)} · post ${x.id}`,
        );
      return rows.length ? rows.join('\n') : 'Nothing is booked on the Page.';
    },
  );

  add('ig_posts', 'The newest Instagram posts (default 10): time, kind, caption, link.', { n }, async ({ n = 10 }) => {
    const a = await g.instagram();
    const r = await g.call('GET', `${a.id}/media`, {
      query: { fields: 'id,caption,timestamp,permalink,media_type', limit: n },
    });
    const rows = (r.data || []).map(
      x =>
        `${x.timestamp ? fmtAt(Date.parse(x.timestamp), tz) : ''} · ${String(x.media_type || '').toLowerCase()} · ${clip(String(x.caption || '').replace(/\s+/g, ' '), 200)} · ${x.permalink || x.id}`,
    );
    return rows.length ? rows.join('\n') : 'No Instagram posts yet.';
  });

  add(
    'page_post',
    'Publish a post on the Facebook Page, or book it with Meta for later with at (more than 10 minutes and up to 30 days ahead; Meta then publishes it even when this computer is off). A picture: image (a JPEG or PNG in the media folders) or imageUrl (a public https link). A link preview: link (not with a picture). Outbound: after the owner\'s OK only, and only exactly as the approved step writes it, so write the step with its arguments as one JSON object and the words in full: page_post({"message": "…", "image": "media/spring.png", "at": "2026-10-22T18:00"}).',
    {
      message: z.string().describe('the post, word for word as approved'),
      link: z.string().optional(),
      image: z.string().optional(),
      imageUrl: z.string().optional(),
      at: z.string().optional().describe('office time, 2026-10-22T18:00; leave out to post now'),
    },
    async ({ message, link, image, imageUrl, at }) => {
      const msg = String(message ?? '').trim();
      if (!msg) say('Write the post in message.');
      if (image && imageUrl) say('Give image or imageUrl, not both.');
      if ((image || imageUrl) && link)
        say('A picture post cannot also carry a link preview. Put the link in the message, or leave the picture out.');
      const file = image ? picture(image) : '';
      const url = imageUrl ? https(imageUrl) : '';
      if (link) https(link);
      // at more than 10 minutes ahead: Meta books it. Its time come (the office waited and ran the step then): now.
      // Never early: a time still ahead but too near for Meta is refused.
      let when = 0;
      if (at) {
        const t = whenOf(at, tz);
        const ahead = t - now();
        if (ahead < -LATE) say(`${fmtAt(t, tz)} has passed, so nothing was posted. Ask for a new time.`);
        if (ahead > MAX_AHEAD)
          say(`${fmtAt(t, tz)} is more than 30 days away; Facebook books posts up to 30 days ahead.`);
        if (ahead > MIN_AHEAD) when = t;
        // too near for Meta to book and not yet due: posting now would be early, so nothing goes out
        else if (ahead > 0)
          say(`It is not ${fmtAt(t, tz)} yet, and Meta books only from 10 minutes ahead, so nothing was posted.`);
      }
      const p = await g.page();
      const later = when ? { published: 'false', scheduled_publish_time: String(Math.floor(when / 1000)) } : {};
      // A picture goes up on its own first (unpublished, kept for this post), then the post is made on the feed with
      // it attached: a photo booked through /photos is published by Meta but never shows in Business Suite's
      // scheduled list, where the owner looks for it and would delete it.
      let media = '';
      if (file || url) {
        const fd = new FormData();
        fd.set('published', 'false');
        fd.set('temporary', 'true');
        if (url) fd.set('url', url);
        else
          fd.set(
            'source',
            await fs.openAsBlob(file, { type: TYPES[path.extname(file).toLowerCase()] }),
            path.basename(file),
          );
        const up = await g.call('POST', `${p.id}/photos`, { multipart: fd });
        if (!up?.id) say('Facebook did not take the picture, so nothing was posted.', 'meta');
        media = JSON.stringify({ media_fbid: String(up.id) });
      }
      const r = await g.call('POST', `${p.id}/feed`, {
        form: {
          message: msg,
          link: link ? https(link) : '',
          ...(media ? { 'attached_media[0]': media } : {}),
          ...later,
        },
      });
      const id = String(r.post_id || r.id || '');
      if (when)
        return `Booked on the Facebook Page ${p.name} for ${fmtAt(when, tz)} (id ${id}). Meta publishes it then, whether or not this computer is on; page_scheduled lists it.`;
      let permalink = '';
      try {
        permalink = (await g.call('GET', id, { query: { fields: 'permalink_url' } })).permalink_url || '';
      } catch {
        // the link is a nicety: the post is up
      }
      return `Posted on the Facebook Page ${p.name}: ${permalink || 'post ' + id}`;
    },
  );

  add(
    'ig_post',
    'Publish a picture post on Instagram (caption up to 2,200 characters and 30 hashtags). The picture: image (a JPEG or PNG in the media folders; it goes to Instagram through the Facebook Page, unpublished there) or imageUrl (a public https JPEG). Meta\'s API cannot book Instagram posts, so for a later time give at: after the owner\'s OK the office waits and runs the steps then (the office must be on). Outbound: after the owner\'s OK only, and only exactly as the approved step writes it, so write the step with its arguments as one JSON object and the words in full: ig_post({"caption": "…", "image": "media/spring.png", "at": "2026-10-22T18:00"}).',
    {
      caption: z.string().describe('the caption, word for word as approved'),
      image: z.string().optional(),
      imageUrl: z.string().optional(),
      altText: z.string().optional().describe('what the picture shows, for people who cannot see it'),
      at: z
        .string()
        .optional()
        .describe('office time, 2026-10-22T18:00: the office posts it then; leave out to post on the OK'),
    },
    async ({ caption, image, imageUrl, altText, at }) => {
      const cap = String(caption ?? '').trim();
      if (!cap) say('Write the caption.');
      if (cap.length > 2200) say(`The caption is ${cap.length} characters; Instagram takes 2,200.`);
      if ((cap.match(/#[\p{L}\p{N}_]+/gu) || []).length > 30) say('Instagram takes up to 30 hashtags.');
      if (!image === !imageUrl)
        say('Give one picture: image (a file in the media folders) or imageUrl (a public https link).');
      if (at) {
        const ahead = whenOf(at, tz) - now();
        if (ahead > 0)
          say(
            "It is not this post's time yet, so nothing was posted: the office runs this step at its at, after the owner's OK.",
          );
        if (ahead < -LATE) say(`${fmtAt(whenOf(at, tz), tz)} has passed, so nothing was posted. Ask for a new time.`);
      }
      const file = image ? picture(image) : '';
      const a = await g.instagram();
      const src = file ? await g.hostPicture(file) : https(imageUrl);
      const c = await g.call('POST', `${a.id}/media`, { form: { image_url: src, caption: cap, alt_text: altText } });
      await g.ready(c.id);
      const m = await g.call('POST', `${a.id}/media_publish`, { form: { creation_id: c.id } });
      let permalink = '';
      try {
        permalink = (await g.call('GET', String(m.id), { query: { fields: 'permalink' } })).permalink || '';
      } catch {
        // the link is a nicety: the post is up
      }
      return `Posted on Instagram @${a.username}: ${permalink || 'media ' + m.id}`;
    },
  );
  return server;
}
