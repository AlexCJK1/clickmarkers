// The office's own Facebook Page and Instagram connector: the tools (what they send to Meta, what they refuse),
// the registry (posting waits for the owner's OK, in his words), the media folders, the Page token from the
// sign-in. No network: Meta is stood in for.
import { test } from 'node:test';
process.env.CLICKMARKERS_NO_MODELS = '1';
process.env.CLICKMARKERS_NO_LOCAL = '1';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Graph, buildServer, READS, WRITES, explain, whenOf, VERSION } from '../servers/meta-tools.mjs';
import { Connectors, globToRe } from '../engines/connectors.mjs';
import { pageToken, PAGE_SCOPES } from '../io/connect-meta.mjs';
import { loadSecrets } from '../core/secrets.mjs';
import { zonedTime } from '../core/clock.mjs';
import { ROOT } from '../core/config.mjs';

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const TOKEN = 'EAAG-page-token-value-123456';
const NOW = zonedTime(2026, 10, 19, 12, 0, 'Europe/London');
const json = (body, status = 200) => ({ status, ok: status < 400, text: async () => JSON.stringify(body) });

/** A stand-in for graph.facebook.com: routes are [/METHOD path-regex/, (req) => body | [status, body]]. */
function fakeMeta(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = new URL(url);
    const req = {
      method: init.method || 'GET',
      path: u.pathname.replace(`/${VERSION}/`, ''),
      query: Object.fromEntries(u.searchParams),
      headers: init.headers || {},
      form: init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : null,
      multipart: typeof FormData !== 'undefined' && init.body instanceof FormData ? init.body : null,
      url: String(url),
    };
    calls.push(req);
    for (const [re, fn] of routes)
      if (re.test(`${req.method} ${req.path}`)) {
        const out = fn(req);
        return Array.isArray(out) ? json(out[1], out[0]) : json(out);
      }
    return json({ error: { message: `no route for ${req.method} ${req.path}`, code: 100 } }, 400);
  };
  return { calls, fetch: f };
}
const PAGE = [/GET me$/, () => ({ id: '111', name: 'Larkspur Cleaning', category: 'Cleaning service' })];
const IG = [/GET 111$/, () => ({ instagram_business_account: { id: '999', username: 'larkspurclean' } })];

async function client(meta, { roots = [], graph = {} } = {}) {
  const g = new Graph({ token: TOKEN, fetch: meta.fetch, pollMs: 1, ...graph });
  const server = buildServer({ graph: g, roots, tz: 'Europe/London', now: () => NOW });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: 'test', version: '1' });
  await c.connect(b);
  const call = async (name, args = {}) => {
    const r = await c.callTool({ name, arguments: args });
    return { error: !!r.isError, text: r.content.map(x => x.text).join('\n') };
  };
  return { c, call, close: () => c.close() };
}
const media = () => {
  const d = tmp('media-');
  fs.writeFileSync(path.join(d, 'spring.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  fs.writeFileSync(path.join(d, 'spring.gif'), 'GIF89a');
  const outside = tmp('elsewhere-');
  fs.writeFileSync(path.join(outside, 'secret.png'), 'x');
  return { d, outside };
};

test('meta tools: the four reads and the two posts, marked as such, and nothing deletes', async () => {
  const { c, close } = await client(fakeMeta([]));
  const tools = (await c.listTools()).tools;
  assert.deepEqual(tools.map(t => t.name).sort(), [...READS, ...WRITES].sort());
  for (const t of tools) assert.equal(t.annotations?.readOnlyHint, READS.includes(t.name), t.name);
  assert.ok(!tools.some(t => /delete|remove|trash/.test(t.name)));
  await close();
});

test('meta registry: an own stdio server, the token by name only, both posts wait for the OK in the approved words', () => {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'company/connectors.json'), 'utf8'));
  const c = reg['meta-pages'];
  assert.equal(c.type, 'stdio');
  assert.equal(c.own, true);
  assert.equal(c.media, true);
  assert.deepEqual(c.needs, ['META_PAGE_TOKEN']);
  assert.match(c.args[0], /servers\/meta\.mjs$/);
  assert.deepEqual([...c.readOnly].sort(), [...READS].sort());
  assert.deepEqual(c.verbatim, ['message', 'caption', 'altText', 'link', 'image', 'imageUrl', 'at']);
  const k = new Connectors(path.join(ROOT, 'company/connectors.json'), { mediaRoots: ['/m/one', '/m/two'] });
  for (const w of WRITES) assert.equal(k.outboundTool('meta-pages', w), true, w);
  for (const r of READS) assert.equal(k.outboundTool('meta-pages', r), false, r);
  // the media folders reach this server, and only servers that ask for them
  const sf = path.join(tmp('s-'), '.secrets.local');
  fs.writeFileSync(sf, `META_PAGE_TOKEN=${TOKEN}\nMAIL_USER=a@example.com\nMAIL_APP_PASSWORD=pw-value\n`);
  loadSecrets(sf);
  const s = k.sdkServers(['meta-pages', 'mail']);
  assert.equal(s['meta-pages'].env.OFFICE_MEDIA_ROOTS, ['/m/one', '/m/two'].join(path.delimiter));
  assert.equal(s.mail.env.OFFICE_MEDIA_ROOTS, undefined);
  assert.doesNotMatch(JSON.stringify(s), new RegExp(TOKEN));
  // the marketing desks have it, in the starter and in the example company
  for (const f of ['company/company.json', 'templates/agency/company.json']) {
    const co = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    assert.ok(co.agents.find(a => a.id === 'mlead').tools.includes('meta-pages'), f);
  }
  assert.ok(
    new Connectors(path.join(ROOT, 'company/connectors.json'))
      .outboundRules(['meta-pages'])
      .map(globToRe)
      .some(re => re.test('mcp__meta-pages__ig_post')),
  );
});

test('page_post now: the words to the feed, the token in a header and never in the link', async () => {
  const meta = fakeMeta([
    PAGE,
    [/POST 111\/feed$/, () => ({ id: '111_5' })],
    [/GET 111_5$/, () => ({ permalink_url: 'https://www.facebook.com/111/posts/5' })],
  ]);
  const { call, close } = await client(meta);
  const r = await call('page_post', {
    message: 'Clear windows by Friday.\nFrom £20.',
    link: 'https://larkspur.example/book',
  });
  assert.equal(r.error, false, r.text);
  assert.match(r.text, /Posted on the Facebook Page Larkspur Cleaning: https:\/\/www\.facebook\.com\/111\/posts\/5/);
  const post = meta.calls.find(x => x.method === 'POST');
  assert.deepEqual(post.form, {
    message: 'Clear windows by Friday.\nFrom £20.',
    link: 'https://larkspur.example/book',
  });
  for (const x of meta.calls) {
    assert.equal(x.headers.Authorization, `Bearer ${TOKEN}`);
    assert.doesNotMatch(x.url, new RegExp(TOKEN));
    assert.match(x.url, /^https:\/\/graph\.facebook\.com\/v25\.0\//);
  }
  await close();
});

test('page_post booked: Meta holds it (10 minutes to 30 days ahead); outside that nothing is sent', async () => {
  const meta = fakeMeta([PAGE, [/POST 111\/feed$/, () => ({ id: '111_6' })]]);
  const { call, close } = await client(meta);
  const r = await call('page_post', { message: 'Thursday post', at: '2026-10-22T18:00' });
  assert.equal(r.error, false, r.text);
  assert.match(
    r.text,
    /Booked on the Facebook Page Larkspur Cleaning for Thu 22 Oct 18:00 .*whether or not this computer is on/,
  );
  const post = meta.calls.find(x => x.method === 'POST');
  assert.equal(post.form.published, 'false');
  assert.equal(+post.form.scheduled_publish_time * 1000, zonedTime(2026, 10, 22, 18, 0, 'Europe/London'));
  const before = meta.calls.length;
  assert.match(
    (await call('page_post', { message: 'x', at: '2026-10-19T10:30' })).text,
    /Mon 19 Oct 10:30 has passed, so nothing was posted/,
  );
  assert.match((await call('page_post', { message: 'x', at: '2026-11-25T12:00' })).text, /more than 30 days away/);
  assert.match((await call('page_post', { message: 'x', at: 'next thursday' })).text, /Not a time I can read/);
  assert.equal(meta.calls.length, before, 'nothing reached Meta');
  // its time has come (the office ran the step at RUN AT): it goes out now, not booked
  assert.match(
    (await call('page_post', { message: 'x', at: '2026-10-19T12:05' })).text,
    /It is not Mon 19 Oct 12:05 yet, and Meta books only from 10 minutes ahead, so nothing was posted/,
    'too near to book and not yet due: never early',
  );
  const r2 = await call('page_post', { message: 'On time', at: '2026-10-19T11:58' });
  assert.match(r2.text, /Posted on the Facebook Page/);
  assert.equal(meta.calls.filter(x => x.method === 'POST').at(-1).form.published, undefined);
  await close();
});

test('page_post with a picture: only from the media folders, JPEG or PNG; the picture goes up first, the post on the feed holds it', async () => {
  const { d, outside } = media();
  const meta = fakeMeta([
    PAGE,
    [/POST 111\/photos$/, () => ({ id: '77' })],
    [/POST 111\/feed$/, () => ({ id: '111_7' })],
    [/GET 111_7$/, () => ({})],
  ]);
  const { call, close } = await client(meta, { roots: [d] });
  const r = await call('page_post', { message: 'Spring windows', image: 'spring.png', at: '2026-10-22T18:00' });
  assert.equal(r.error, false, r.text);
  const [up, post] = meta.calls.filter(x => x.method === 'POST');
  assert.equal(up.path, '111/photos');
  assert.equal(up.multipart.get('source').name, 'spring.png');
  assert.equal(up.multipart.get('published'), 'false', 'the picture alone is never shown');
  assert.equal(up.multipart.get('temporary'), 'true');
  assert.equal(up.multipart.get('caption'), null, 'the words go on the post, not the picture');
  // booked through the feed, as Business Suite shows it (a photo booked through /photos never appears there)
  assert.equal(post.path, '111/feed');
  assert.equal(post.form.message, 'Spring windows');
  assert.equal(post.form['attached_media[0]'], '{"media_fbid":"77"}');
  assert.equal(post.form.published, 'false');
  assert.equal(+post.form.scheduled_publish_time * 1000, zonedTime(2026, 10, 22, 18, 0, 'Europe/London'));
  // a public picture link goes up the same way
  await call('page_post', { message: 'Now', imageUrl: 'https://cdn.example/p.jpg' });
  const [up2, post2] = meta.calls.filter(x => x.method === 'POST').slice(-2);
  assert.equal(up2.multipart.get('url'), 'https://cdn.example/p.jpg');
  assert.equal(post2.form.published, undefined, 'published now');
  const n = meta.calls.length;
  assert.match(
    (await call('page_post', { message: 'x', image: path.join(outside, 'secret.png') })).text,
    /not a picture in the media folders/,
  );
  assert.match(
    (await call('page_post', { message: 'x', image: '../' + path.basename(outside) + '/secret.png' })).text,
    /not a picture in the media folders/,
  );
  assert.match((await call('page_post', { message: 'x', image: 'spring.gif' })).text, /only JPEG and PNG/);
  assert.match(
    (await call('page_post', { message: 'x', image: 'spring.png', link: 'https://a.example' })).text,
    /cannot also carry a link preview/,
  );
  assert.match(
    (await call('page_post', { message: 'x', imageUrl: 'http://a.example/p.jpg' })).text,
    /Only https links/,
  );
  assert.equal(meta.calls.length, n, 'nothing reached Meta');
  await close();
  const none = await client(fakeMeta([PAGE]), { roots: [] });
  assert.match((await none.call('page_post', { message: 'x', image: 'spring.png' })).text, /No media folder is set/);
  await none.close();
});

test('ig_post: the picture goes up to the Page unpublished, Instagram takes its link, waits until ready, then publishes', async () => {
  const { d } = media();
  let polls = 0;
  const meta = fakeMeta([
    PAGE,
    IG,
    [/POST 111\/photos$/, () => ({ id: '88' })],
    [
      /GET 88$/,
      () => ({
        images: [
          { width: 320, source: 'https://scontent.example/small.jpg' },
          { width: 1080, source: 'https://scontent.example/big.jpg' },
        ],
      }),
    ],
    [/POST 999\/media$/, () => ({ id: 'c1' })],
    [/GET c1$/, () => ({ status_code: ++polls < 2 ? 'IN_PROGRESS' : 'FINISHED' })],
    [/POST 999\/media_publish$/, () => ({ id: 'm1' })],
    [/GET m1$/, () => ({ permalink: 'https://www.instagram.com/p/abc/' })],
  ]);
  const { call, close } = await client(meta, { roots: [d] });
  const r = await call('ig_post', {
    caption: 'Spring windows #bristol',
    image: 'spring.png',
    altText: 'A clean window',
  });
  assert.equal(r.error, false, r.text);
  assert.match(r.text, /Posted on Instagram @larkspurclean: https:\/\/www\.instagram\.com\/p\/abc\//);
  const up = meta.calls.find(x => x.method === 'POST' && x.path === '111/photos');
  assert.equal(up.multipart.get('published'), 'false', 'never shown on the Page');
  const container = meta.calls.find(x => x.path === '999/media');
  assert.deepEqual(container.form, {
    image_url: 'https://scontent.example/big.jpg',
    caption: 'Spring windows #bristol',
    alt_text: 'A clean window',
  });
  assert.deepEqual(meta.calls.find(x => x.path === '999/media_publish').form, { creation_id: 'c1' });
  assert.equal(polls, 2);
  const order = meta.calls.filter(x => x.method === 'POST').map(x => x.path);
  assert.deepEqual(order, ['111/photos', '999/media', '999/media_publish']);
  await close();
});

test('ig_post refuses what Meta would not take, and a time to book: nothing reaches Meta', async () => {
  const { d } = media();
  const meta = fakeMeta([PAGE, IG]);
  const { call, close } = await client(meta, { roots: [d] });
  assert.match(
    (await call('ig_post', { caption: 'x', image: 'spring.png', at: '2026-10-22T18:00' })).text,
    /not this post's time yet, so nothing was posted: the office runs this step at its at/,
  );
  assert.match((await call('ig_post', { caption: 'x'.repeat(2201), image: 'spring.png' })).text, /2,200/);
  assert.match(
    (await call('ig_post', { caption: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' '), image: 'spring.png' }))
      .text,
    /30 hashtags/,
  );
  assert.match((await call('ig_post', { caption: 'x' })).text, /Give one picture/);
  assert.match(
    (await call('ig_post', { caption: 'x', image: 'spring.png', imageUrl: 'https://a.example/p.jpg' })).text,
    /Give one picture/,
  );
  assert.equal(meta.calls.filter(x => x.method === 'POST').length, 0);
  assert.match(
    (await call('ig_post', { caption: 'x', image: 'spring.png', at: '2026-10-19T09:00' })).text,
    /has passed, so nothing was posted/,
  );
  assert.equal(meta.calls.filter(x => x.method === 'POST').length, 0);
  await close();
});

test('ig_post: a Page with no Instagram account, and a picture Instagram refuses, are said plainly; nothing published', async () => {
  const { d } = media();
  const none = fakeMeta([PAGE, [/GET 111$/, () => ({})]]);
  const a = await client(none, { roots: [d] });
  assert.match(
    (await a.call('ig_post', { caption: 'x', imageUrl: 'https://a.example/p.jpg' })).text,
    /has no Instagram professional account linked/,
  );
  await a.close();
  const bad = fakeMeta([
    PAGE,
    IG,
    [/POST 999\/media$/, () => ({ id: 'c2' })],
    [/GET c2$/, () => ({ status_code: 'ERROR', status: 'Error: image aspect ratio' })],
  ]);
  const b = await client(bad, { roots: [d] });
  assert.match(
    (await b.call('ig_post', { caption: 'x', imageUrl: 'https://a.example/p.jpg' })).text,
    /could not take the picture \(Error: image aspect ratio\)\. Nothing was posted/,
  );
  assert.ok(!bad.calls.some(x => x.path === '999/media_publish'));
  await b.close();
});

test("meta errors: an expired token, a missing permission, a person's token; the token never shows in an answer", async () => {
  assert.equal(explain(400, { error: { code: 190, message: 'Session has expired' } }).kind, 'auth');
  assert.equal(explain(403, { error: { code: 200, message: 'Requires pages_manage_posts' } }).kind, 'permission');
  assert.equal(explain(400, { error: { code: 4, message: 'Application request limit reached' } }).kind, 'limit');
  const expired = fakeMeta([
    [/GET me$/, () => [400, { error: { code: 190, message: `Invalid OAuth access token ${TOKEN}` } }]],
  ]);
  const a = await client(expired);
  const r = await a.call('page_posts');
  assert.equal(r.error, true);
  assert.match(r.text, /refused the Page token .*META_PAGE_TOKEN/);
  assert.doesNotMatch(r.text, new RegExp(TOKEN));
  await a.close();
  const person = fakeMeta([
    [
      /GET me$/,
      () => [
        400,
        { error: { code: 100, message: '(#100) Tried accessing nonexisting field (category) on node type (User)' } },
      ],
    ],
  ]);
  const b = await client(person);
  assert.match((await b.call('social_accounts')).text, /a person's token, not a Page token/);
  await b.close();
  const blank = await client(fakeMeta([]), { graph: { token: '' } });
  assert.match((await blank.call('page_posts')).text, /META_PAGE_TOKEN is not set/);
  await blank.close();
});

test('meta reads: accounts with the Instagram allowance, Page posts, booked posts in time order, Instagram posts', async () => {
  const meta = fakeMeta([
    PAGE,
    IG,
    [/GET 999\/content_publishing_limit$/, () => ({ data: [{ quota_usage: 3, config: { quota_total: 100 } }] })],
    [
      /GET 111\/posts$/,
      () => ({
        data: [
          {
            id: '111_1',
            created_time: '2026-10-18T17:00:00+0000',
            message: 'Hello\nBristol',
            permalink_url: 'https://fb.example/1',
          },
        ],
      }),
    ],
    [
      /GET 111\/scheduled_posts$/,
      () => ({
        data: [
          { id: 'b', message: 'Later', scheduled_publish_time: Math.floor(zonedTime(2026, 10, 23, 9, 0) / 1000) },
          { id: 'a', message: 'Sooner', scheduled_publish_time: Math.floor(zonedTime(2026, 10, 22, 18, 0) / 1000) },
        ],
      }),
    ],
    [
      /GET 999\/media$/,
      () => ({
        data: [
          {
            id: 'm',
            caption: 'Pic',
            timestamp: '2026-10-18T10:00:00+0000',
            permalink: 'https://ig.example/m',
            media_type: 'IMAGE',
          },
        ],
      }),
    ],
  ]);
  const { call, close } = await client(meta);
  assert.match(
    (await call('social_accounts')).text,
    /Larkspur Cleaning \(id 111\)\nInstagram: @larkspurclean \(id 999\) · 3 of 100 posts used/,
  );
  assert.match(
    (await call('page_posts', { n: 5 })).text,
    /Sun 18 Oct 18:00 · Hello Bristol · https:\/\/fb\.example\/1/,
  );
  assert.equal(meta.calls.find(x => x.path === '111/posts').query.limit, '5');
  const booked = (await call('page_scheduled')).text.split('\n');
  assert.match(booked[0], /Thu 22 Oct 18:00 · Sooner/);
  assert.match(booked[1], /Fri 23 Oct 09:00 · Later/);
  assert.match((await call('ig_posts')).text, /image · Pic · https:\/\/ig\.example\/m/);
  assert.equal(meta.calls.filter(x => x.method !== 'GET').length, 0, 'reads only read');
  await close();
});

test('meta: an app secret adds the proof Meta asks for, never the secret itself', async () => {
  const meta = fakeMeta([PAGE, [/GET 111\/posts$/, () => ({ data: [] })]]);
  const { call, close } = await client(meta, { graph: { appSecret: 'app-secret-value' } });
  await call('page_posts');
  for (const x of meta.calls) {
    assert.match(x.query.appsecret_proof, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(x.url, /app-secret-value/);
  }
  await close();
});

test('meta times: office time, a full ISO time, and nonsense', () => {
  assert.equal(whenOf('2026-10-22T18:00', 'Europe/London'), zonedTime(2026, 10, 22, 18, 0, 'Europe/London'));
  assert.equal(whenOf('2026-10-22 18:00', 'Europe/London'), zonedTime(2026, 10, 22, 18, 0, 'Europe/London'));
  assert.equal(whenOf('2026-10-22T17:00:00Z'), Date.parse('2026-10-22T17:00:00Z'));
  assert.throws(() => whenOf('2026-02-30T10:00'), /Not a time I can read/);
  assert.throws(() => whenOf('tomorrow'), /Not a time I can read/);
});

test('connect meta: the sign-in asks for posting too, and keeps the Page token of the only Page or the one named', async () => {
  assert.deepEqual(PAGE_SCOPES, [
    'pages_read_engagement',
    'pages_manage_posts',
    'instagram_basic',
    'instagram_content_publish',
  ]);
  const pages = data => async url => {
    assert.match(String(url), /\/me\/accounts\?/);
    return { json: async () => ({ data }) };
  };
  const one = await pageToken('user', '', { fetch: pages([{ id: '1', name: 'Larkspur', access_token: 'pt1' }]) });
  assert.equal(one.page.token, 'pt1');
  const two = [
    { id: '1', name: 'Larkspur', access_token: 'pt1' },
    { id: '2', name: 'Larkspur Gutters', access_token: 'pt2' },
  ];
  assert.equal((await pageToken('user', '', { fetch: pages(two) })).page, null, 'several Pages: none picked');
  assert.equal((await pageToken('user', 'larkspur gutters', { fetch: pages(two) })).page.token, 'pt2');
  assert.equal((await pageToken('user', '2', { fetch: pages(two) })).page.token, 'pt2');
  assert.deepEqual((await pageToken('user', '', { fetch: pages(two) })).pages, [
    { id: '1', name: 'Larkspur' },
    { id: '2', name: 'Larkspur Gutters' },
  ]);
  await assert.rejects(
    pageToken('user', '', { fetch: async () => ({ json: async () => ({ error: { message: 'bad token' } }) }) }),
    /pages: bad token/,
  );
});
