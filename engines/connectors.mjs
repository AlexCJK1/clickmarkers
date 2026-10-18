// The connector registry: every outside tool the office may hand a desk, by key. A desk lists keys in
// company.json; the engines turn them into MCP server configs. Headers may reference secrets as
// ${NAME}; the value is resolved at run time and never written anywhere.
//
// connectors.json entry:
//   { "label": "Meta Ads", "type": "http" | "sse" | "stdio", "url" | "command"+"args", "headers": {},
//     "auth": "oauth" | "bearer" | "none", "outbound": ["tool name globs that send or change things"],
//     "readOnly": ["the only tool names that run before the OK"] (instead of outbound; mail_draft, which only files a
//       draft in the owner's own Drafts folder, is on the mailbox's list),
//     "private": true (it reads the owner's own material: mail, files, a CRM), "web": true (it reaches the open web),
//     "verbatim": ["message"] (after the OK, an outbound call runs only as a step writes it, these arguments the same),
//     "waits": ["ig_post"] (tools that cannot book themselves: the office waits for the "at" their step carries),
//     "words": ["message"] (held fields compared as the owner reads them: spacing and line breaks may differ),
//     "files": ["image"] (held fields naming a picture in the media folders: held by its content too),
//     "media": true (an own server that may read pictures from the media folders: it is told where they are),
//     "verified": true|false, "notes": "" }
// An office-owned stdio server ("own": true) reads its secrets from the secrets file itself: it is given
// the file's path (OFFICE_SECRETS_FILE) and the office time zone (OFFICE_TZ), never the values, so no
// secret sits on a command line. "needs" names the secrets it must find there.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../core/config.mjs';
import { officeTime } from '../core/clock.mjs';
import { secret, secretsSource } from '../core/secrets.mjs';

const CLEAN_ENV = path.join(ROOT, 'core', 'clean-env.mjs');

export class Connectors {
  constructor(file, { timezone = 'Europe/London', mediaRoots = [] } = {}) {
    this.file = file;
    this.timezone = timezone;
    this.mediaRoots = mediaRoots;
    this.load();
  }
  load() {
    this.map = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^﻿/, ''));
    this.mtime = fs.statSync(this.file).mtimeMs;
    return this;
  }
  reloadIfChanged() {
    try {
      if (fs.statSync(this.file).mtimeMs !== this.mtime) this.load();
    } catch {
      // the file is mid-save or gone for a moment: keep the copy in memory, look again next tick
    }
  }
  get(key) {
    return this.map[key] || null;
  }
  keys() {
    return Object.keys(this.map);
  }
  /** Which of a desk's keys exist and are usable now (a bearer connector needs its secret). */
  usable(keys = []) {
    const out = [],
      missing = [];
    for (const k of keys) {
      const c = this.get(k);
      if (!c || c.disabled) {
        missing.push(`${k}: not in the registry`);
        continue;
      }
      const need = unresolved(c);
      if (need.length) {
        missing.push(`${k}: needs secret ${need.join(', ')}`);
        continue;
      }
      out.push(k);
    }
    return { keys: out, missing };
  }
  /** The server name a tool id carries: mcp__<id>__tool. An inherited connector keeps the name Claude Code gave it. */
  toolId(k) {
    const c = this.get(k);
    return c?.type === 'inherit' ? String(c.server || k).replace(/[^A-Za-z0-9_-]+/g, '_') : k;
  }
  /** Does any of these connectors come from the user's own Claude Code setup (slow boot, no strict mode)? */
  inherits(keys = []) {
    return this.usable(keys).keys.some(k => this.get(k)?.type === 'inherit');
  }
  /**
   * SDK mcpServers for a desk. The SDK hands this to Claude Code on its command line, which other programs on the
   * machine can read, so a secret stays a ${NAME} template here and its value travels in the child's environment
   * (secretEnv), which Claude Code expands. `resolve: true` puts the values in, for a caller that starts the
   * server itself (callDirect).
   */
  sdkServers(keys = [], { resolve = false } = {}) {
    const servers = {};
    const fill = h => (resolve ? resolveHeaders(h) : { ...(h || {}) });
    for (const k of this.usable(keys).keys) {
      const c = this.get(k);
      if (c.type === 'inherit') continue;
      if (c.type === 'stdio') {
        const env = {
          ...(c.env ? fill(c.env) : {}),
          ...(c.own ? { OFFICE_SECRETS_FILE: secretsSource(), OFFICE_TZ: this.timezone } : {}),
          ...(c.own && c.media ? { OFFICE_MEDIA_ROOTS: this.mediaRoots.join(path.delimiter) } : {}),
        };
        // {root} in an argument is this install's folder, so the registry carries no machine's own path. The server
        // starts through the clean-env launcher: it sees its own variables and the basics, never the office's keys.
        const args = (c.args || []).map(a => String(a).split('{root}').join(ROOT));
        servers[k] = {
          type: 'stdio',
          command: process.execPath,
          args: [CLEAN_ENV, '--keep', Object.keys(env).join(','), '--', c.command, ...args],
          env: Object.keys(env).length ? env : undefined,
        };
      } else servers[k] = { type: c.type === 'sse' ? 'sse' : 'http', url: c.url, headers: fill(c.headers) };
    }
    return servers;
  }
  /** The secret values the ${NAME} templates in these connectors' headers and env need, for the child's environment. */
  secretEnv(keys = []) {
    const out = {};
    for (const k of this.usable(keys).keys) {
      const c = this.get(k);
      for (const v of [...Object.values(c.headers || {}), ...Object.values(c.env || {})])
        for (const m of String(v).matchAll(/\$\{([A-Z0-9_]+)\}/g)) out[m[1]] = secret(m[1]);
    }
    return out;
  }
  /** Messages API mcp_servers for a desk (remote http only; a bearer token becomes authorization_token). */
  apiServers(keys = []) {
    const out = [];
    for (const k of this.usable(keys).keys) {
      const c = this.get(k);
      if (c.type === 'stdio') continue;
      const h = resolveHeaders(c.headers);
      const auth = h.Authorization || h.authorization || '';
      out.push({
        type: 'url',
        url: c.url,
        name: k,
        ...(auth ? { authorization_token: auth.replace(/^Bearer\s+/i, '') } : {}),
      });
    }
    return out;
  }
  /** Tool names to remove from a desk's context: everything a server is known to offer that is not on its
   *  "only" list (registry) or the desk's toolsOnly list. Needs the server's known names (registry "known",
   *  updated by the health probe). */
  excluded(keys = [], toolsOnly = {}, known = {}) {
    const out = [];
    for (const k of keys) {
      const c = this.get(k);
      if (!c) continue;
      const only = toolsOnly[k] || c.only;
      if (!only || !only.length) continue;
      const names = known[k] || c.known || [];
      if (!names.length) continue;
      const keep = only.map(globToRe);
      for (const n of names) if (!keep.some(re => re.test(n))) out.push(`mcp__${this.toolId(k)}__${n}`);
    }
    return out;
  }
  /**
   * Does this tool send or change something (so it waits for the owner's OK)? A connector with a readOnly list
   * allows those names only. Otherwise a name its outbound globs list is outbound, and so is any name that does
   * not plainly say it reads: it runs before the OK only when a reading verb (get, list, search, read ...) leads it,
   * follows one prefix (ads_get_insights) or ends it (campaign_get), no part is a writing word, and it does not
   * join two actions (list_and_launch). So a tool nobody listed, or one a server adds later (buy_domain,
   * events_trigger, batch), waits for the OK rather than being trusted. An unknown connector is outbound.
   * A connector whose reads are named otherwise (ads_insights_trend) carries a readOnly list.
   */
  outboundTool(k, name) {
    const c = this.get(k);
    if (!c) return true;
    if (Array.isArray(c.readOnly)) return !c.readOnly.map(globToRe).some(re => re.test(name));
    if ((c.outbound || []).map(globToRe).some(re => re.test(name))) return true;
    const n = String(name);
    const segs = n.split(/[_\-.]+/).filter(Boolean);
    if (WRITE_WORDS.test(n) || segs.some(x => JOINS.test(x))) return true;
    return ![0, 1, segs.length - 1].some(i => segs[i] && READ_VERBS.test(segs[i]));
  }
  /** Tool-name patterns that send or change things, for the draft phase. */
  outboundRules(keys = []) {
    const out = [];
    for (const k of keys) {
      const c = this.get(k);
      if (!c) continue;
      for (const g of c.outbound || []) out.push(`mcp__${this.toolId(k)}__${g}`);
    }
    return out;
  }
  view() {
    return Object.entries(this.map).map(([key, c]) => ({
      key,
      label: c.label || key,
      type: c.type,
      auth: c.auth || (c.headers ? 'bearer' : 'none'),
      verified: !!c.verified,
      disabled: !!c.disabled,
      heavy: !!c.heavy,
      missing: unresolved(c),
      outbound: (c.outbound || []).length,
      notes: c.notes || '',
    }));
  }
}

/**
 * Is this tool named in the text (the approved steps) as a call? A name counts written as a call, name( or
 * `name` or mcp__server__name, and an identifier-like name (send_email, edit-design) also counts standing on
 * its own as a whole name. A plain word in prose does not: "reply to Mrs Smith" names no tool called reply.
 * send_email is not named by send_email_draft. Case counts: tool names are exact.
 */
export function namedIn(text, name) {
  const n = String(name || '');
  if (!n) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const end = '(?![A-Za-z0-9_-])';
  const shapes = [`__${esc}${end}`, `\`${esc}${end}`, `(?:^|[^A-Za-z0-9_-])${esc}\\(`];
  if (/[_\-.]/.test(n)) shapes.push(`(?:^|[^A-Za-z0-9_-])${esc}${end}`);
  return new RegExp(shapes.join('|')).test(String(text || ''));
}

/**
 * The places a text points at, as whole tokens: email addresses (anything around an @), links with a scheme, and
 * bare domains with or without a path (larkspur-pay.example/now), in any script, lower-cased, trailing punctuation off.
 */
export function targetsIn(text) {
  const out = new Set();
  const t = String(text || '');
  const add = x => out.add(x.replace(/[.,;:!?'")\]}>]+$/u, '').toLowerCase());
  for (const m of t.matchAll(/[^\s<>"'(),;:[\]{}]+@[^\s<>"'(),;:[\]{}]+/gu)) add(m[0]);
  const rest = t.replace(/[^\s<>"'(),;:[\]{}]+@[^\s<>"'(),;:[\]{}]+/gu, ' ');
  for (const m of rest.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/giu)) add(m[0]);
  const bare = rest.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/giu, ' ');
  for (const m of bare.matchAll(
    /(?<![\p{L}\p{N}@.-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+\p{L}{2,}(?:\/[^\s<>"'`]*)?/gu,
  ))
    add(m[0]);
  return out;
}
/**
 * The first place an outbound call would reach that the approved draft does not hold, or ''. Compared as whole
 * tokens: info@larkspur.co is not info@larkspur.co.uk, and larkspur.example.co is not larkspur.example. After the
 * OK a call may only reach the people and places the owner saw, so a step approved for one address cannot be
 * pointed at another, or given a second recipient, by anything the run read since. File names count as places too
 * (flyer.png): the steps carry them in full.
 */
export function unapprovedTarget(input, draft) {
  const seen = targetsIn(draft);
  const strings = [];
  const walk = v => {
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(input);
  for (const s of strings) {
    const odd = hiddenAddress(s);
    if (odd) return odd;
    for (const x of targetsIn(s)) if (!seen.has(x)) return x;
  }
  return '';
}
/**
 * An address written so that targetsIn cannot read it, or ''. A mail server reads "evil(x)@attacker.example" and
 * "\"evil\"@attacker.example" as evil@attacker.example, and "evil@[203.0.113.5]" as an address too. So an @ that is
 * not inside a plain address, with a domain or a [ after it, counts as a place nobody approved. A handle in a post
 * (@LarkspurClean, no dot after it) is not an address and passes.
 */
export function hiddenAddress(text) {
  const t = String(text || '');
  const plain = /[^\s<>"'(),;:[\]{}]+@[^\s<>"'(),;:[\]{}]+/gu;
  const covered = [];
  for (const m of t.matchAll(plain)) covered.push([m.index, m.index + m[0].length]);
  for (const m of t.matchAll(/@/g)) {
    if (covered.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const after = t.slice(m.index + 1);
    const dom = after.match(/^\s*(\[[^\]]*\]|[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)/u);
    if (dom)
      return (
        t
          .slice(Math.max(0, m.index - 40), m.index)
          .split(/[\s,;<]/)
          .pop() +
        '@' +
        dom[1]
      ).toLowerCase();
  }
  return '';
}

/**
 * A value as the owner reads it, for comparing a call with the step he approved: escapes a desk writes in a call
 * (\n, \") undone, curly quotes made straight, emoji style marks and zero-width characters dropped, and every run
 * of white space one space. Nothing else changes: a word, a letter's case, a digit or a mark like * still counts.
 */
export function plainWords(text) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/\\[nrt]/g, '\n')
    .replace(/\\(["'\\])/g, '$1')
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/\uFE0E|\uFE0F|\u200B|\u200C|\u200D|\u2060/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// A step call starts its line (after a list mark like "1." or "-", and a backtick or bold if any): a call written
// inside a sentence ("do NOT post option B: page_post(...)") is prose, not a step.
const CALL_AT = name =>
  new RegExp(`^[\\t ]*(?:[-*•]|\\d+[.)])?[\\t ]*(?:\\*\\*|\`)?(?:mcp__[A-Za-z0-9_-]+__)?${name}\\s*\\(\\s*`, 'gm');
/**
 * The arguments of one call, read as JSON from just after its "(": one object such as {"caption": "…", "image": "…"}
 * and then the call's ")". JSON has one reading: a quote inside a value is written \", so nothing can end a post
 * early. Unreadable, so the step holds nothing: anything that is not one such object, a key written twice (the owner
 * reads the first, JSON.parse keeps the last), text after the object, or a \u escape (the owner reads the code, the
 * post would carry the character).
 */
function readCall(s, from) {
  if (s[from] !== '{') return { bad: true };
  let depth = 0;
  let quoted = false;
  let str = '';
  const keys = new Set();
  let dup = false;
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '\\') {
        if (s[i + 1] === 'u') return { bad: true };
        str += ch + s[i + 1];
        i++;
      } else if (ch === '"') {
        quoted = false;
        // a string at the top level followed by ":" is a key
        if (depth === 1 && /^\s*:/.test(s.slice(i + 1, i + 20))) {
          if (keys.has(str)) dup = true;
          keys.add(str);
        }
      } else str += ch;
    } else if (ch === '"') {
      quoted = true;
      str = '';
    } else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (!depth) {
        if (dup || !/^\s*\)/.test(s.slice(i + 1, i + 40))) return { bad: true };
        try {
          const args = JSON.parse(s.slice(from, i + 1));
          return args && typeof args === 'object' && !Array.isArray(args) ? { args } : { bad: true };
        } catch {
          return { bad: true };
        }
      }
    }
  }
  return { bad: true };
}
/**
 * The calls to a tool written in the approved steps, each as { args } read as JSON, or { bad: true } when its
 * arguments are not one JSON object: page_post({"message": "…", "image": "…"}), or with the full tool name.
 */
export function stepCalls(steps, name) {
  const s = String(steps ?? '');
  const n = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!n) return [];
  return [...s.matchAll(CALL_AT(n))].map(m => readCall(s, m.index + m[0].length));
}
/**
 * After the OK, an outbound call to a connector that holds its arguments ("verbatim": the words of a post, its
 * picture, its link, its time) must be one of the calls the approved steps write for that tool, with each held
 * argument present or absent alike and the same: exactly, or, for the fields in `words` (a post's text), the same as
 * the owner reads it (plainWords). A held value that is not a string, or a step whose arguments cannot be read,
 * matches nothing. The same call written twice is one call, and each runs once: `used` holds what has run.
 * Returns { key } of the step it matches, or { field } that differs from the nearest unused one ('call' if none).
 */
export function heldCall({ name, input = {}, fields = [], words = [], steps = '', used = new Set() }) {
  const val = (f, v) => (v == null ? '' : words.includes(f) ? plainWords(v) : v);
  const plain = v => v == null || typeof v === 'string';
  let field = '';
  for (const c of stepCalls(steps, name)) {
    if (c.bad || fields.some(f => !plain(c.args[f]))) {
      field ||= 'arguments (the step does not write them as one JSON object of plain values)';
      continue;
    }
    const key = JSON.stringify(fields.map(f => val(f, c.args[f])));
    if (used.has(key)) continue;
    const off = fields.find(f => !plain(input?.[f]) || val(f, input?.[f]) !== val(f, c.args[f]));
    if (!off) return { key };
    field ||= off;
  }
  return { field: field || 'call' };
}
/**
 * The time in a draft's posting steps: every "at" of a tool on a connector that holds its arguments. Returns { time }
 * (0: none), waits (a tool in the connector's "waits" list, which cannot book itself, carries it: the office must
 * wait for it), held (the steps post through such a connector), images (the local pictures the steps name, for
 * their "files" fields); or { error } when a step cannot be read, a time is not a real office time, or two steps
 * ask for two times (one could go out and the other not).
 */
export function bookingOf(steps, connectors, tz = 'Europe/London') {
  const times = new Set();
  const images = new Set();
  let held = false;
  let waits = false;
  let untimed = false;
  for (const k of connectors.keys()) {
    const c = connectors.get(k);
    if (!c?.verbatim?.length) continue;
    for (const tool of c.outbound || []) {
      for (const call of stepCalls(steps, tool)) {
        held = true;
        if (call.bad) return { error: `a ${tool} step does not write its arguments as one JSON object` };
        for (const f of c.files || [])
          if (call.args[f] != null && call.args[f] !== '') {
            if (typeof call.args[f] !== 'string') return { error: `a ${tool} step's ${f} is not a plain text` };
            images.add(call.args[f]);
          }
        const at = call.args.at;
        if (at == null || at === '') {
          untimed = true;
          continue;
        }
        const t = typeof at === 'string' ? officeTime(at, tz) : 0;
        if (!t)
          return {
            error: `${tool}'s time ${JSON.stringify(at).slice(0, 40)} is not a time it can read; write "at": "2026-10-22T18:00" (office time)`,
          };
        times.add(t);
        if ((c.waits || []).includes(tool)) waits = true;
      }
    }
  }
  if (times.size > 1) return { error: 'the steps ask for more than one time; one time per draft' };
  // one post with a time and another without would go out at two times, and the owner is shown only one
  if (times.size && untimed)
    return { error: 'one posting step has a time and another has none; give them the same time' };
  return { time: [...times][0] || 0, waits, held, images: [...images] };
}

/** Words in a tool's name that mean it sends or changes something, as a whole segment (create_file, send-email). */
export const WRITE_WORDS =
  /(^|[_\-.])(create|update|delete|remove|send|post|publish|upload|move|copy|share|edit|write|insert|append|set|pause|activate|deactivate|import|revoke|schedule|boost|add|apply|cancel|archive|trash|merge|rename|replace|run|execute|evaluate|fill|click|type|press|drag|select|drop|grant|invite|transfer|pay|charge|refund|submit|approve|reject|reply|forward|label|mark|restore|clear|reset|install|deploy|purge|use|enable|disable|connect|disconnect|duplicate|rotate|verify|manage|generate|resize|buy|purchase|order|lock|unlock|untrash|unlabel|unmark|batch|book|sign|withdraw|deposit|trigger|toggle|patch|launch|push|close|start|stop|notify|invoke|restart|kill|terminate|commit|enqueue|dispatch|emit|broadcast)([_\-.]|$)/i;
/** The verbs that say a tool only reads, as a whole part of its name. */
export const READ_VERBS =
  /^(get|list|search|read|find|fetch|describe|view|lookup|show|count|inspect|preview|browse|download|export|whoami|help)$/i;
const JOINS = /^(and|or|then|plus)$/i;
export const globToRe = g =>
  new RegExp(
    '^' +
      String(g)
        .split('*')
        .map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      '$',
  );
function unresolved(c) {
  const need = [];
  for (const v of Object.values(c.headers || {}))
    for (const m of String(v).matchAll(/\$\{([A-Z0-9_]+)\}/g)) if (!secret(m[1])) need.push(m[1]);
  for (const v of Object.values(c.env || {}))
    for (const m of String(v).matchAll(/\$\{([A-Z0-9_]+)\}/g)) if (!secret(m[1])) need.push(m[1]);
  for (const n of c.needs || []) if (!secret(n)) need.push(n);
  return need;
}
function resolveHeaders(h = {}) {
  const out = {};
  for (const [k, v] of Object.entries(h)) out[k] = String(v).replace(/\$\{([A-Z0-9_]+)\}/g, (_, n) => secret(n));
  return out;
}

/**
 * How an owner's own copy of the connector registry (made by `clickmarkers init`) differs from the one in the
 * repo: connectors the repo has and the copy lacks, and connectors whose server, version or read/write lists
 * differ. An update reaches the repo's file only, so `check` names these for the owner to compare.
 */
export function registryDrift(ownerFile, repoFile) {
  const read = f => {
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
    } catch {
      return null;
    }
  };
  const mine = read(ownerFile),
    repo = read(repoFile);
  if (!mine || !repo || path.resolve(ownerFile) === path.resolve(repoFile)) return { added: [], changed: [] };
  const shape = c =>
    JSON.stringify(
      ['url', 'command', 'args', 'readOnly', 'outbound', 'only', 'verbatim', 'waits', 'words', 'files'].map(
        k => c?.[k] ?? null,
      ),
    );
  const added = Object.keys(repo).filter(k => !(k in mine));
  const changed = Object.keys(repo).filter(k => k in mine && shape(mine[k]) !== shape(repo[k]));
  return { added, changed };
}
