// The HTTP face of the office: a JSON API, a live event stream, and the page. It listens on this machine
// only (127.0.0.1). Another address (the LAN, a tunnel) is refused unless CLICKMARKERS_TOKEN is set in the
// secrets file; then every /api call must carry it. Open the page once as /?token=<it> and the browser keeps it
// in a cookie only this office can read.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ROOT } from '../core/config.mjs';
import { brief } from '../company/tickets.mjs';
import { log, emit } from '../core/events.mjs';
import { parseWhen, parseAt, fmtAt } from '../core/when.mjs';
import { callDirect } from '../engines/mcpcall.mjs';
import { buildGraph, readNote } from '../brain/graph.mjs';
import { secret } from '../core/secrets.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.map': 'application/json',
};

export const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];
const same = (a, b) => {
  const x = Buffer.from(String(a || '')),
    y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};
const cookieOf = (req, name) => {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name)
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return '';
      }
  }
  return '';
};
/**
 * Why the office must not start as configured, or '': listening on another address, or answering to another
 * name in allowHosts (a tunnel or a proxy forwards to 127.0.0.1 and passes its own name), needs the token.
 */
export function bindProblem(cfg, token = secret('CLICKMARKERS_TOKEN')) {
  const loopName = h =>
    LOOPBACK.includes(String(h).replace(/^\[|\]$/g, '')) ||
    LOOPBACK.includes(
      String(h)
        .replace(/:\d+$/, '')
        .replace(/^\[|\]$/g, ''),
    );
  const wide = [
    ...(LOOPBACK.includes(String(cfg.host || '127.0.0.1')) ? [] : [cfg.host]),
    ...(cfg.allowHosts || []).filter(h => !loopName(h)),
  ];
  if (!wide.length || String(token || '').length >= 24) return '';
  return `the office has no login of its own, so it answers on this machine only. To open it as ${wide.join(', ')}, put CLICKMARKERS_TOKEN=<at least 24 random characters> in the secrets file and open the page once as http://<address>:${cfg.port}/?token=<it>. Plain http is not encrypted: on a shared network use a tunnel that adds https.`;
}
// What the demo office refuses: anything that would run a desk, start a connector or reach outside.
const DEMO_OFF = [
  /^\/api\/office\/resume$/,
  /^\/api\/tickets\/[^/]+\/(approve|retry|reply)$/,
  /^\/api\/routines\/[^/]+\/run$/,
  /^\/api\/workflows$/,
  /^\/api\/connectors\/probe$/,
  /^\/api\/stats\/refresh$/,
  /^\/api\/lanes\/api\/up$/,
];

export function serve(office) {
  const { cfg } = office;
  let graphCache = null;
  const bad = bindProblem(cfg);
  if (bad) throw new Error(bad);
  const webDir = cfg.webDir ? path.resolve(cfg.webDir) : path.join(ROOT, 'web'); // cfg.webDir: the tests serve a page of their own
  // The build id: the hash of the page file being served, read when asked, so a rebuild changes it without a restart. A page
  // keeps the id it first saw and reloads itself once if /api/health later answers with another (see seeBuild in the pages).
  const buildId = () => {
    try {
      const dist = path.join(webDir, 'dist', 'index.html');
      return createHash('sha256')
        .update(fs.readFileSync(fs.existsSync(dist) ? dist : path.join(webDir, 'index.html')))
        .digest('hex')
        .slice(0, 12);
    } catch {
      return '';
    }
  };
  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const body = req =>
    new Promise((ok, no) => {
      let s = '';
      req.on('data', c => {
        s += c;
        if (s.length > 1e6) no(new Error('too big'));
      });
      req.on('end', () => {
        try {
          ok(s ? JSON.parse(s) : {});
        } catch (e) {
          no(e);
        }
      });
    });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const m = req.method;
    const token = secret('CLICKMARKERS_TOKEN');
    if (token && !p.startsWith('/api/') && url.searchParams.has('token')) {
      // the page opened with the token: keep it in a cookie, drop it from the address
      if (!same(url.searchParams.get('token'), token)) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        return res.end('wrong token');
      }
      res.writeHead(302, {
        location: '/',
        'set-cookie': `cm_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
        'cache-control': 'no-store',
      });
      return res.end();
    }
    // No login, so only this machine's own page may drive the API: the Host must be this office (no
    // DNS rebinding), and a change (anything but GET) must come from this office's own origin with a
    // JSON body (a cross-site form or a "simple" fetch cannot send one without a preflight).
    if (p.startsWith('/api/')) {
      const host = String(req.headers.host || '').toLowerCase();
      const port = server.address()?.port;
      const okHost = h =>
        [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, ...(cfg.allowHosts || [])].includes(h);
      if (!okHost(host)) return json(res, 403, { error: 'wrong host' });
      if (
        token &&
        !same(cookieOf(req, 'cm_token'), token) &&
        !same(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''), token)
      )
        return json(res, 401, { error: 'open the page with ?token=<CLICKMARKERS_TOKEN> once' });
      if (cfg.demo && m !== 'GET' && DEMO_OFF.some(re => re.test(p)))
        return json(res, 403, {
          error: 'This is the demo: nothing runs, nothing is sent. Install it with your own business to use this.',
        });
      if (m !== 'GET' && m !== 'HEAD') {
        const origin = req.headers.origin;
        const site = req.headers['sec-fetch-site'];
        const devOrigin = h => (cfg.devOrigins || ['localhost:4601', '127.0.0.1:4601']).includes(h); // npm run ui:dev proxies from here
        if (
          origin &&
          !okHost(
            String(origin)
              .replace(/^https?:\/\//, '')
              .toLowerCase(),
          ) &&
          !devOrigin(
            String(origin)
              .replace(/^https?:\/\//, '')
              .toLowerCase(),
          )
        )
          return json(res, 403, { error: 'cross-site request refused' });
        if (site && !['same-origin', 'none'].includes(site))
          return json(res, 403, { error: 'cross-site request refused' });
        if (
          !/^application\/json\b/i.test(String(req.headers['content-type'] || '')) &&
          (+req.headers['content-length'] || 0) > 0
        )
          return json(res, 415, { error: 'send JSON' });
      }
    }
    try {
      if (p === '/api/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        for (const e of office.events.recent(150, +url.searchParams.get('since') || 0))
          res.write(`data: ${JSON.stringify(e)}\n\n`);
        const off = office.events.subscribe(e => res.write(`data: ${JSON.stringify(e)}\n\n`));
        const ping = setInterval(() => res.write(': ping\n\n'), 20000);
        req.on('close', () => {
          off();
          clearInterval(ping);
        });
        return;
      }
      if (p === '/api/health') return json(res, 200, { ...office.health(), build: buildId() });
      if (p === '/api/company') return json(res, 200, office.company.chart());
      if (p === '/api/connectors' && m === 'GET') return json(res, 200, office.connectorHealth.view());
      if (p === '/api/connectors/probe' && m === 'POST') {
        const b = await body(req);
        const keys =
          b.keys === 'used' ? office.usedConnectors() : Array.isArray(b.keys) ? b.keys : office.usedConnectors();
        return json(res, 200, await office.connectorHealth.probe(keys));
      }
      if (p === '/api/stats') return json(res, 200, office.vault.stats(cfg.stats?.file) || { error: 'no stats file' });
      if (p === '/api/ledger/series') {
        const days = office.ledger.days(+url.searchParams.get('days') || 14);
        const agents = [...new Set(days.flatMap(d => Object.keys(d.byAgent)))];
        return json(res, 200, {
          days: days.map(d => d.day),
          total: days.map(d => d.usd),
          est: days.map(d => d.estUsd),
          runs: days.map(d => d.runs),
          byAgent: Object.fromEntries(agents.map(a => [a, days.map(d => d.byAgent[a] || 0)])),
        });
      }
      if (p === '/api/workflows' && m === 'GET') return json(res, 200, office.workflows.view());
      if (p === '/api/workflows' && m === 'POST') {
        const b = await body(req);
        return json(res, 200, brief(office.workflows.run(office, b.name, b.topic || '', { by: 'owner' })));
      }
      if (p === '/api/routines' && m === 'GET') return json(res, 200, office.routines.view());
      if (p === '/api/routines/parse' && m === 'POST') {
        const b = await body(req);
        return json(res, 200, parseWhen(b.text || ''));
      }
      if (p === '/api/routines' && m === 'POST') {
        const r = await body(req);
        if (r.sentence) {
          try {
            return json(res, 200, await office.addRoutine(r));
          } catch (e) {
            return json(res, 400, { error: e.message });
          }
        }
        try {
          return json(res, 200, office.saveRoutine(r));
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
      }
      const rm = p.match(/^\/api\/routines\/([^/]+)(?:\/(run|pause|resume))?$/);
      if (rm && m === 'POST') {
        const [, id, act] = rm;
        if (!office.routines.get(id)) return json(res, 404, { error: 'no such routine' });
        if (act === 'run') {
          const t = await office.runRoutine(id);
          return json(res, 200, t?.id ? brief(t) : { ok: true });
        }
        if (act) return json(res, 200, office.routines.pause(id, act === 'pause'));
        try {
          return json(res, 200, office.editRoutine(id, await body(req)));
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
      }
      if (rm && m === 'DELETE') {
        office.routines.remove(rm[1]);
        return json(res, 200, { ok: true });
      }
      if (p === '/api/stats/refresh' && m === 'POST') {
        const c = cfg.stats?.refresh;
        if (!c?.connector || !c?.tool)
          return json(res, 501, { error: 'no stats refresh is set up (office.config.json: stats.refresh)' });
        const r = await callDirect(office, c.connector, c.tool);
        emit('stats', { ok: r.ok, error: r.ok ? undefined : r.error });
        return json(
          res,
          r.ok ? 200 : 502,
          r.ok ? { ok: true, stats: office.vault.stats(cfg.stats?.file) } : { error: r.error },
        );
      }
      if (p === '/api/ledger')
        return json(res, 200, {
          ceilingUsd: office.ledger.ceilingUsd,
          gbpPerUsd: office.ledger.gbpPerUsd,
          today: office.ledger.day(),
          days: office.ledger.days(+url.searchParams.get('days') || 14),
          recent: office.ledger.recent(+url.searchParams.get('n') || 40),
        });
      if (p === '/api/activity') return json(res, 200, office.events.recent(+url.searchParams.get('n') || 200));
      if (p === '/api/brain')
        return json(res, 200, {
          notes: office.vault.names(),
          inbox: office.vault.inbox().map(f => ({ name: f.name, size: f.size, mtime: f.mtime })),
        });
      if (p === '/api/brain/graph') {
        if (!graphCache || Date.now() - graphCache.at > 30000 || url.searchParams.has('refresh'))
          graphCache = { at: Date.now(), g: buildGraph(cfg.brain) };
        const lastRead = {};
        for (const e of office.events.recent(600))
          if (e.type === 'reads')
            for (const n of e.notes || []) lastRead[n] = { agent: e.agent, at: e.at, ticket: e.ticket };
        return json(res, 200, { ...graphCache.g, lastRead });
      }
      if (p === '/api/brain/note') {
        const n = readNote(cfg.brain, url.searchParams.get('rel'));
        return n ? json(res, 200, n) : json(res, 404, { error: 'no such note' });
      }
      if (p === '/api/calendar') {
        const from = +url.searchParams.get('from') || Date.now() - 7 * 86400000;
        const to = +url.searchParams.get('to') || from + 35 * 86400000;
        return json(res, 200, office.calendar(from, to));
      }
      const cm = p.match(/^\/api\/chat\/([^/]+)$/);
      if (cm && m === 'GET')
        return json(res, 200, {
          messages: office.chat.history(cm[1]),
          interview: (office.chat.leads(cm[1]) && office.chat.interviewState(office.chat.leads(cm[1]).id)) || null,
          lead: !!office.chat.leads(cm[1]),
          setUp: office.chat.leads(cm[1]) ? office.chat.setUp(office.chat.leads(cm[1]).id) : null,
        });
      if (cm && m === 'POST') {
        const b = await body(req);
        try {
          return json(res, 200, await office.chat.say(cm[1], b.text));
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
      }
      if (cm && m === 'DELETE') {
        office.chat.clear(cm[1]);
        return json(res, 200, { ok: true });
      }
      if (p === '/api/tickets' && m === 'GET') {
        const state = url.searchParams.get('state');
        return json(
          res,
          200,
          office.tickets
            .all({ state: state ? state.split(',') : undefined, agent: url.searchParams.get('agent') || undefined })
            .slice(0, +url.searchParams.get('n') || 200)
            .map(brief),
        );
      }
      if (p === '/api/tickets' && m === 'POST') {
        const b = await body(req);
        try {
          const t = await office.submit({
            text: b.text,
            title: b.title,
            dept: b.dept,
            agent: b.agent,
            by: b.by || 'owner',
            needsOk: b.needsOk,
            model: b.model || undefined,
            effort: b.effort || undefined,
            engine: b.engine,
            priority: b.priority,
            lane: b.lane,
            at: b.at ? +b.at : 0,
            evaluate: b.evaluate === false ? false : undefined,
          });
          return json(res, 200, brief(t));
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
      }
      if (p === '/api/when' && m === 'POST') {
        const b = await body(req);
        const r = parseAt(b.text || '', { tz: cfg.timezone });
        return json(res, 200, r ? { ...r, atText: fmtAt(r.at, cfg.timezone) } : { at: 0 });
      }
      const tm = p.match(/^\/api\/tickets\/([^/]+)(?:\/([a-z]+))?$/);
      if (tm) {
        const [, id, action] = tm;
        const t = office.tickets.get(id);
        if (!t) return json(res, 404, { error: 'no such ticket' });
        if (m === 'GET' && !action)
          return json(res, 200, {
            ...brief(t),
            text: t.text,
            result: t.result,
            draft: t.draft,
            calls: t.calls,
            mcp: t.mcp,
            why: t.why,
            reads: t.reads || [],
          });
        // The OK is for the draft the page showed: it sends that draft's hash (brief.draftHash). No hash means an old page, and a different one means the draft has changed.
        if (m === 'POST' && action === 'approve') {
          const b = await body(req);
          if (!b.hash) {
            // a page from before the hash was sent shows nothing of the refusal, so the office says so where the owner will see it
            const why = 'Approve came from an old page: reload it, nothing was approved.';
            emit('approval', { ticket: id, agent: t.agent, verdict: 'not approved', note: why });
            try {
              await office.phone?.send?.(why);
            } catch {
              // the phone is a courtesy; the refusal is already on the page and the wire
            }
            return json(res, 409, { error: 'reload: the draft has changed or the page is old' });
          }
          try {
            return json(res, 200, brief(office.approve(id, b.hash) || t));
          } catch (e) {
            return json(res, e.code === 'stale' ? 409 : 400, { error: e.message });
          }
        }
        if (m === 'POST' && action === 'reject') {
          const b = await body(req);
          return json(res, 200, brief(office.reject(id, b.note || '') || t));
        }
        if (m === 'POST' && action === 'retry') return json(res, 200, brief(office.retry(id) || t));
        if (m === 'POST' && action === 'cancel') return json(res, 200, brief(office.cancel(id) || t));
        if (m === 'POST' && action === 'comment') {
          const b = await body(req);
          return json(res, 200, brief(office.tickets.comment(id, 'owner', b.text || '') || t));
        }
        if (m === 'POST' && action === 'reply') {
          const b = await body(req);
          return json(res, 200, brief(await office.reply(id, b.text || '')));
        }
        if (m === 'GET' && action === 'thread')
          return json(res, 200, office.tickets.thread(t.thread || t.id, 20).map(brief));
        return json(res, 405, { error: 'no' });
      }
      const lm = p.match(/^\/api\/agents\/([^/]+)\/lessons\/(rule|oneoff)\/(\d+)$/);
      if (lm && m === 'DELETE')
        return json(res, 200, {
          ok: office.vault.removeLesson(lm[1], lm[2], +lm[3]),
          lessons: office.vault.lessons(lm[1]),
        });
      const am = p.match(/^\/api\/agents\/([^/]+)\/(pause|resume)$/);
      if (am && m === 'POST')
        return json(res, 200, office.pauseAgent(am[1], am[2] === 'pause') ? { ok: true } : { error: 'no such desk' });
      const ag = p.match(/^\/api\/agents\/([^/]+)$/);
      if (ag && m === 'GET') {
        const a = office.company.agent(ag[1]);
        if (!a) return json(res, 404, { error: 'no such desk' });
        const health = office.connectorHealth.view();
        return json(res, 200, {
          ...a,
          lessons: office.vault.lessons(a.id),
          notebook: office.vault.notebook(a.id, 2000),
          routines: office.routines.view().filter(r => r.agent === a.id),
          connectors: (a.tools || []).map(
            k => health.find(c => c.key === k) || { key: k, missing: ['not in the registry'] },
          ),
          today: office.ledger.day().byAgent[a.id] || 0,
          lead: office.company.lead(a.dept)?.id === a.id,
          chief: office.company.chief()?.id === a.id,
        });
      }
      if (ag && m === 'PUT') {
        const b = await body(req);
        try {
          const a = office.company.save(ag[1], b);
          emit('board', { agent: ag[1], change: 'brief' });
          return json(res, 200, a);
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
      }
      if (p === '/api/office/pause' && m === 'POST') {
        office.pauseOffice(true);
        return json(res, 200, { ok: true });
      }
      if (p === '/api/office/resume' && m === 'POST') {
        office.pauseOffice(false);
        return json(res, 200, { ok: true });
      }
      if (p === '/api/lanes/api/up' && m === 'POST') {
        office.lanes.apiUp();
        return json(res, 200, office.lanes.state());
      }
      // static: the built page in web/dist when it exists, else the bare page; unknown paths fall back to index
      const dist = path.join(webDir, 'dist');
      const root = fs.existsSync(path.join(dist, 'index.html')) ? dist : webDir;
      let f = path.join(root, p === '/' ? 'index.html' : p.replace(/^\/+/, ''));
      if (!f.startsWith(root)) return json(res, 403, { error: 'no' });
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
        f = path.join(root, 'index.html');
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(f)] || 'application/octet-stream',
        'cache-control': /\/assets\//.test(f) ? 'public, max-age=31536000, immutable' : 'no-store',
      });
      fs.createReadStream(f).pipe(res);
    } catch (e) {
      log.warn(`${m} ${p}:`, e.message);
      json(res, 500, { error: e.message });
    }
  });
  // an empty host would make Node listen on every address: it means this machine, as bindProblem reads it
  const host = String(cfg.host || '127.0.0.1');
  server.listen(cfg.port, host, () => log.info(`${office.company.name}: http://${host}:${cfg.port}`));
  return server;
}
