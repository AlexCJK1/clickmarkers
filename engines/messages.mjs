// The messages engine: the Anthropic Messages API called directly, for jobs that do not need a
// harness. Explicit prompt caching (the system block and the tools carry a 1-hour cache mark), the
// server-side web tools when a desk may use the web, remote MCP connectors through the API's own
// connector, and a batch mode: the same request queued on the Message Batches API at half price,
// collected when it lands (most within the hour). Always the API lane; no key, no engine.
import path from 'node:path';
import { secret, redact } from '../core/secrets.mjs';
import { jsonFile } from '../core/store.mjs';
import { modelId } from '../company/model.mjs';
import { systemPrompt, userPrompt, approvedSteps, runsOnWeb } from './prompt.mjs';
import { classifyApiError } from '../core/lanes.mjs';
import { globToRe, namedIn } from './connectors.mjs';
import { INTERRUPTED } from '../company/tickets.mjs';

const API = 'https://api.anthropic.com/v1';
const VERSION = '2023-06-01';
const MCP_BETA = 'mcp-client-2026-09-15';
const PRICE = { // USD per million tokens: input, output, cache write (1h), cache read
  'claude-opus-5-5': [4, 20, 8, 0.2], 'claude-sonnet-5-5': [2, 10, 4, 0.1], 'claude-haiku-5-5': [0.1, 0.5, 0.2, 0.01],
};

export function priceOf(model, u = {}, { batch = false } = {}) {
  const p = PRICE[model] || PRICE['claude-sonnet-5-5'];
  const usd = ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] + (u.cache_creation_input_tokens || 0) * p[2] + (u.cache_read_input_tokens || 0) * p[3]) / 1e6;
  return Math.round(usd * (batch ? 0.5 : 1) * 1e6) / 1e6;
}

function headers(extraBeta = []) {
  const h = { 'content-type': 'application/json', 'anthropic-version': VERSION, 'x-api-key': secret('ANTHROPIC_API_KEY') };
  if (extraBeta.length) h['anthropic-beta'] = extraBeta.join(',');
  return h;
}

/** Build the request body for a ticket phase on a desk. Shared by the live and batch paths. */
export function buildRequest({ office, ticket, agent, phase, childResults = [], maxTokens = 4000 }) {
  const { cfg, company, vault, connectors } = office;
  const model = modelId(ticket.model || agent.model);
  const system = systemPrompt({ company, agent, connectors, vault, officeTools: [], phase });
  const user = userPrompt({ ticket, phase, vault, tickets: office.tickets, events: office.events, tz: cfg.timezone, statsFile: cfg.stats?.file, childResults, web: runsOnWeb({ agent, company, connectors }) });
  const body = {
    model, max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
    messages: [{ role: 'user', content: user }],
  };
  const effort = ticket.effort || agent.effort; if (effort && !/haiku/.test(model)) body.output_config = { effort };
  const tools = [];
  if (agent.web && phase !== 'execute') tools.push({ type: 'web_search_20260318', name: 'web_search', max_uses: 5 }, { type: 'web_fetch_20260318', name: 'web_fetch', max_uses: 5 });
  // Remote connectors through the API's own MCP client, always as an allow-list of known tool names: before the
  // owner's OK (draft and wrap) the names that are not outbound (by list or by name); after it (execute, which
  // runPhase sends to the agent engine anyway) only the names the approved steps call. A server whose tool names are not known yet (never probed) is left
  // out rather than trusted, in every phase, and so is anything a server adds later.
  const known = office.health_?.known?.() || {};
  const steps = phase === 'execute' ? approvedSteps(ticket) : '';
  const betas = [];
  const servers = [];
  // The same trimming as the agent engine: the registry's "only" list or the desk's toolsOnly narrows a
  // server first, then the outbound rules take out what sends or changes things.
  for (const s of connectors.apiServers(agent.tools || [])) {
    const c = connectors.get(s.name) || {};
    const only = (agent.toolsOnly || {})[s.name] || c.only || null;
    let names = known[s.name] || c.known || [];
    if (!names.length && only && only.every(g => !String(g).includes('*'))) names = only;
    if (!names.length) continue;
    const keep = only ? only.map(globToRe) : null;
    const allowed = names.filter(n => (!keep || keep.some(re => re.test(n))) && (phase === 'execute' ? namedIn(steps, n) : !connectors.outboundTool(s.name, n)));
    if (!allowed.length) continue;
    servers.push({ type: s.type, url: s.url, name: s.name }); tools.push({ type: 'mcp_toolset', mcp_server_name: s.name, default_config: { enabled: false }, configs: Object.fromEntries(allowed.map(n => [n, { enabled: true }])) });
  }
  if (servers.length) { body.mcp_servers = servers; betas.push(MCP_BETA); }
  if (tools.length) { tools[tools.length - 1].cache_control = { type: 'ephemeral', ttl: '1h' }; body.tools = tools; }
  return { body, betas, model };
}

/**
 * The connectors' tokens go into a request body only on its way out. buildRequest leaves them out, so the copy a
 * batch keeps on disk (data/batches.json) never holds one; they are looked up again from the secrets when it is sent.
 */
export function withTokens(body, connectors) {
  if (!body?.mcp_servers?.length) return body;
  const live = new Map(connectors.apiServers(body.mcp_servers.map(s => s.name)).map(s => [s.name, s]));
  return { ...body, mcp_servers: body.mcp_servers.map(({ authorization_token, ...s }) => { const l = live.get(s.name); return l?.authorization_token ? { ...s, authorization_token: l.authorization_token } : s; }) };
}
const noTokens = body => (body?.mcp_servers?.length ? { ...body, mcp_servers: body.mcp_servers.map(({ authorization_token, ...s }) => s) } : body);

function textOf(message) { return (message?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim(); }
function callsOf(message, t0) { return (message?.content || []).filter(b => b.type === 'mcp_tool_use' || b.type === 'server_tool_use').map(b => ({ at: Date.now() - t0, server: b.server_name || 'claude', tool: b.name })); }

/** One live call. Same result shape as runAgent. */
export async function runMessages({ office, ticket, agent, phase, childResults = [], signal }) {
  const t0 = Date.now();
  if (!secret('ANTHROPIC_API_KEY')) return fail('no ANTHROPIC_API_KEY for the messages engine', 'auth', t0);
  const { body, betas, model } = buildRequest({ office, ticket, agent, phase, childResults });
  try {
    const res = await fetch(`${API}/messages`, { method: 'POST', headers: headers(betas), body: JSON.stringify(withTokens(body, office.connectors)), signal });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const msg = j.error?.message || `HTTP ${res.status}`; return fail(msg, classifyApiError(msg, res.status) || 'api', t0, model); }
    const text = textOf(j); const usd = priceOf(model, j.usage);
    office.events.emit('run', { ticket: ticket.id, agent: agent.id, stage: 'booted', bootMs: 0, model, lane: 'api', engine: 'oneshot' });
    for (const c of callsOf(j, t0)) office.events.emit('call', { ticket: ticket.id, agent: agent.id, ...c });
    return { ok: !!text, text, error: text ? '' : `stop_reason ${j.stop_reason}`, kind: text ? '' : 'run', cost: { usd, estUsd: usd, tokens: tokens(j.usage) }, timings: { bootMs: 0, modelMs: Date.now() - t0, totalMs: Date.now() - t0 }, calls: callsOf(j, t0), mcp: [], model, lane: 'api', turns: 1, missing: [], stop: j.stop_reason || '' };
  } catch (e) { return fail(redact(e.message), classifyApiError(e.message) || 'network', t0, model); }
}

/** The batch queue: tickets submitted together, polled, and resolved through office.finishBatch(). */
export class Batches {
  constructor(office) {
    this.office = office; this.store = jsonFile(path.join(office.cfg.data, 'batches.json'), { pending: [], open: [] }); this.st = this.store.read(); this.resultsErr = new Map();
    // a queue saved by an older version may hold connector tokens: they are taken out and fetched again at the flush
    if ((this.st.pending || []).some(i => i.params?.mcp_servers?.some(m => m.authorization_token))) { this.st.pending = this.st.pending.map(i => ({ ...i, params: noTokens(i.params) })); this.save(); }
    this.reconcile();
  }
  /**
   * At start: a ticket that waits "doing" on a batch answer, with no open or pending batch item left to bring it, is
   * stranded (the answer was lost, or it was run on the direct engine when the office stopped). It goes back in the
   * queue with a note. An item already handed over does not count: its answer is gone.
   */
  reconcile() {
    try {
      const live = [...(this.st.pending || []), ...(this.st.open || []).flatMap(b => b.items || [])].filter(i => !i.handed);
      for (const t of [...this.office.tickets.list]) {
        if (t.state !== 'doing' || t.engine !== 'batch') continue;
        if (live.some(i => i.ticket === t.id && (!i.runId || !t.runId || i.runId === t.runId))) continue;
        if (t.phase === 'execute') { this.office.tickets.update(t.id, { state: 'failed', error: INTERRUPTED, checking: false, pendingDraft: '', pendingFixed: [] }); this.office.events.emit('batch', { stage: 'stranded approved run failed', ticket: t.id }); continue; } // it may have run: never again on its own
        this.office.tickets.update(t.id, { state: 'next', note: `${t.note ? t.note + ' ' : ''}(restarted: no batch answer was left to wait for, so it goes again)`, checking: false, pendingDraft: '', pendingFixed: [] });
        this.office.events.emit('batch', { stage: 'stranded ticket requeued', ticket: t.id });
      }
    } catch (e) { this.office.events.emit('batch', { stage: 'reconcile failed', error: redact(e.message).slice(0, 200) }); }
  }
  /** An answer that cannot be taken fails its ticket with the reason, instead of leaving it "doing" for good. */
  strand(item, why) {
    const o = this.office; const t = o.tickets.get(item.ticket);
    if (!t || t.state !== 'doing' || (item.runId && t.runId && t.runId !== item.runId)) return;
    const error = redact(String(why)).slice(0, 300);
    o.release?.(item.ticket, item.runId || '');
    const failed = o.tickets.update(item.ticket, { state: 'failed', error, checking: false, pendingDraft: '', pendingFixed: [] });
    o.events.emit('run', { ticket: item.ticket, agent: t.agent, stage: 'failed', error });
    if (t.by === 'telegram' || t.routine) o.phone?.notifyResult(failed || o.tickets.get(item.ticket), o.company.agent(t.agent)?.name);
  }
  save() { this.store.write(this.st); }
  /** Queue a ticket run; it goes up with the next flush. */
  enqueue({ ticket, agent, phase }) {
    const { body, betas, model } = buildRequest({ office: this.office, ticket, agent, phase });
    // runId ties the answer to the run that asked: an answer that comes back for a ticket that has moved on is dropped
    this.st.pending.push({ custom_id: `${ticket.id}-${phase}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64), ticket: ticket.id, agent: agent.id, phase, model, betas, params: noTokens(body), at: Date.now(), runId: this.office.tickets.get(ticket.id)?.runId || ticket.runId || '' });
    this.save();
    this.office.events.emit('batch', { ticket: ticket.id, agent: agent.id, stage: 'queued', pending: this.st.pending.length });
  }
  /** Send everything pending as one batch. */
  async flush() {
    if (!this.st.pending.length || !secret('ANTHROPIC_API_KEY') || this.office.cfg.demo) return null; // the demo sends nothing
    if (this.retryAt && Date.now() < this.retryAt) return null;
    const items = this.st.pending.splice(0); const betas = [...new Set(items.flatMap(i => i.betas))];
    const res = await fetch(`${API}/messages/batches`, { method: 'POST', headers: headers(betas), body: JSON.stringify({ requests: items.map(i => ({ custom_id: i.custom_id, params: withTokens(i.params, this.office.connectors) })) }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { this.st.pending.unshift(...items); this.save(); this.retryAt = Date.now() + 10 * 60000; this.office.events.emit('batch', { stage: 'failed', error: redact(j.error?.message || `HTTP ${res.status}`).slice(0, 200) }); throw new Error(redact(j.error?.message || `batch HTTP ${res.status}`)); }
    this.st.open.push({ id: j.id, at: Date.now(), items: items.map(({ params, ...rest }) => rest) }); this.save();
    this.office.events.emit('batch', { stage: 'sent', id: j.id, count: items.length });
    return j.id;
  }
  /** Poll open batches; hand finished results to the office. */
  async poll() {
    // finishRun can now wait on the evaluations check, so a second tick must not start on a batch whose results are still being handed over
    if (this.polling) return;
    this.polling = true;
    try { await this.pollOnce(); } finally { this.polling = false; }
  }
  async pollOnce() {
    for (const b of [...this.st.open]) {
      let j; try { const res = await fetch(`${API}/messages/batches/${b.id}`, { headers: headers() }); j = await res.json(); } catch { continue; }
      if (j.processing_status !== 'ended') continue;
      // A results download that fails (a 429, a 500, a dropped connection) says nothing about the answers: they stay downloadable
      // for days. The batch stays open and the next poll asks again; no ticket is failed for it. (ok === false: a real Response always has ok.)
      let res, lines; try { res = await fetch(`${API}/messages/batches/${b.id}/results`, { headers: headers() }); } catch { continue; }
      if (res.ok === false) { if (this.resultsErr.get(b.id) !== res.status) { this.resultsErr.set(b.id, res.status); this.office.events.emit('batch', { stage: 'results unavailable, will ask again', id: b.id, status: res.status }); } continue; }
      this.resultsErr.delete(b.id); try { lines = (await res.text()).split('\n').filter(Boolean); } catch { continue; }
      for (const line of lines) {
        let r; try { r = JSON.parse(line); } catch { continue; }
        const item = b.items.find(i => i.custom_id === r.custom_id); if (!item || item.handed) continue;
        // Handed over exactly once, and saved before the hand-over: finishRun can wait minutes on the evaluations
        // check, and an office that stops in that time must not hand the same answer over again when it comes back.
        item.handed = Date.now(); this.save();
        const ok = r.result?.type === 'succeeded'; const msg = r.result?.message;
        const usd = ok ? priceOf(item.model, msg.usage, { batch: true }) : 0;
        try { await this.office.finishRun(item.ticket, item.phase, { ok: ok && !!textOf(msg), text: ok ? textOf(msg) : '', error: ok ? '' : `batch ${r.result?.type}: ${r.result?.error?.message || ''}`, kind: ok ? '' : 'run', cost: { usd, estUsd: usd, tokens: tokens(msg?.usage) }, timings: { bootMs: 0, modelMs: 0, totalMs: Date.now() - item.at }, calls: [], mcp: [], model: item.model, lane: 'api', turns: 1, missing: [], engine: 'batch', stop: msg?.stop_reason || '' }, item.runId || ''); }
        catch (e) { this.office.events.emit('batch', { stage: 'hand-over failed', ticket: item.ticket, error: redact(e.message).slice(0, 200) }); this.strand(item, `the batch answer could not be taken: ${e.message}`); } // one bad answer must not stall the rest of the batch, and its ticket must not wait for it
      }
      for (const item of b.items) if (!item.handed) { item.handed = Date.now(); this.strand(item, 'the batch ended with no answer for this ticket'); } // no line for it: do not wait for ever
      this.st.open = this.st.open.filter(x => x.id !== b.id); this.save();
      this.office.events.emit('batch', { stage: 'landed', id: b.id, count: lines.length });
    }
  }
  view() { return { pending: this.st.pending.length, open: this.st.open.map(b => ({ id: b.id, at: b.at, count: b.items.length })) }; }
}

const tokens = (u = {}) => ({ in: u.input_tokens || 0, out: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 });
const fail = (error, kind, t0, model = '') => ({ ok: false, text: '', error, kind, cost: { usd: 0, estUsd: 0, tokens: tokens() }, timings: { bootMs: 0, modelMs: 0, totalMs: Date.now() - t0 }, calls: [], mcp: [], model, lane: 'api', turns: 0, missing: [] });
