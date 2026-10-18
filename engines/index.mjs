// Engine dispatch. A desk (or a ticket) names its engine; every Anthropic run is billed to the owner's API
// key, within the daily ceiling and the desk's budget (core/lanes.mjs). A billing or auth failure rests the
// API for a while; the jobs wait meanwhile.
//   agent     Claude Agent SDK, tools and sub-agents                            (the default; every approved run)
//   oneshot   Messages API direct, cached prompt, server tools                  (agent on a billing or auth error)
//   batch     Messages Batches API, half price, usually within the hour (up to 24 h; oneshot when urgent)
//   openrouter another vendor's model (OpenRouter or any compatible service), no tools; never re-run on Claude
import { runAgent, teamOf } from './agent.mjs';
import { runMessages } from './messages.mjs';
import { runOpenRouter } from './openrouter.mjs';
import { secret } from '../core/secrets.mjs';
import { classifyApiError } from '../core/lanes.mjs';

export const ENGINES = ['agent', 'oneshot', 'batch', 'openrouter'];

/** Run a ticket phase now (batch returns { deferred: true } after queueing). */
const refused = error => ({
  ok: false,
  refused: true,
  text: '',
  error,
  kind: 'config',
  cost: { usd: 0, estUsd: 0, tokens: {} },
  timings: {},
  calls: [],
  mcp: [],
  model: '',
  lane: '',
  turns: 0,
  missing: [],
});
/** No quick model call may be made: the demo office, or the tests' switch. */
export const modelsOff = office => process.env.CLICKMARKERS_NO_MODELS === '1' || !!office?.cfg?.demo;

export async function runPhase(office, ticket, phase, { childResults = [], signal, engines = {} } = {}) {
  // the demo office runs no desk, whatever is pressed (only an engine handed in, a test's stand-in, still runs)
  const off = !!office.cfg?.demo;
  const no = async () => refused('this is the demo office: nothing runs here');
  if (off && !engines.agent) return no();
  const _agent = engines.agent || (off ? no : runAgent),
    _messages = engines.messages || (off ? no : runMessages),
    _openrouter = engines.openrouter || (off ? no : runOpenRouter);
  const agent = office.company.agent(ticket.agent);
  if (!agent) return refused(`no desk called ${ticket.agent}`);
  // a run that reads private material and reaches the web does not start unless the owner has accepted that for this desk
  const exposed = office.exposures?.().find(e => e.agent === agent.id);
  if (exposed && !(office.cfg.security?.acceptExposure || []).includes(agent.id))
    return refused(
      `${agent.name} reads private material (${exposed.reads.join(', ')}) and reaches the open web in the same run, so it does not run. Take one of the two out of the run, or add "${agent.id}" to security.acceptExposure in office.config.local.json to accept the risk.`,
    );
  // the approved steps run on the agent engine only: its gate checks every call and its arguments, which the
  // API's own connector (oneshot, batch) cannot, and OpenRouter has no tools to carry anything out with
  let engine = phase === 'execute' ? 'agent' : ticket.engine || agent.engine || 'agent';
  const hasKey = !!secret('ANTHROPIC_API_KEY');

  if (engine === 'batch') {
    if (hasKey && !ticket.urgent && !off) {
      office.batches.enqueue({ ticket, agent, phase });
      return { deferred: true, engine: 'batch' };
    }
    engine = hasKey ? 'oneshot' : 'agent';
  }
  // A desk the owner put on another model stays there. Its failures are reported, never re-run on Claude: the
  // owner may have chosen that service so the work does not go to Anthropic.
  if (engine === 'openrouter') {
    const r = await _openrouter({ office, ticket, agent, phase, childResults, signal });
    if (r.ok) return { ...r, engine };
    const fix =
      r.kind === 'auth'
        ? ' It was not run on Claude instead. Fix the other model\'s key or address, or set the desk\'s engine to "agent".'
        : '';
    return { ...r, error: `${r.error || 'the other model did not answer'}.${fix}`.replace('..', '.'), engine };
  }
  if (engine === 'oneshot') {
    if (hasKey && !office.lanes.state().apiDown) {
      const r = await _messages({ office, ticket, agent, phase, childResults, signal });
      if (r.ok || !['billing', 'auth'].includes(r.kind)) return { ...r, engine };
      office.lanes.apiDown(r.error);
    }
    engine = 'agent';
  }
  // agent engine. A desk that needs a claude.ai connector cannot run: those ride on a Claude subscription login,
  // which tools built on the Agent SDK may not use.
  const inherits =
    office.connectors.inherits(agent.tools || []) ||
    teamOf({ company: office.company, agent }).some(a => office.connectors.inherits(a.tools || []));
  if (inherits)
    return refused(
      "this desk uses a claude.ai connector, which needs a Claude subscription login; Clickmarkers runs on an API key only. Give the desk the connector's direct server instead.",
    );
  const pick = office.lanes.pick(agent);
  if (!pick.lane) return { ...refused(`not run: ${pick.reason}`), kind: pick.wait ? 'wait' : 'config' };
  const r = await _agent({ office, ticket, agent, phase, lane: 'api', capUsd: pick.capUsd, childResults, signal });
  if (!r.ok && ['billing', 'auth'].includes(r.kind)) office.lanes.apiDown(r.error);
  else if (r.ok) office.lanes.apiUp();
  return { ...r, engine: 'agent' };
}

/**
 * A quick model call with no tools: routing, sorting a lesson, a chat reply, the interview write-up. On the
 * API, under the daily ceiling (the system prompt carries a 1-hour cache mark). Billed to `agent` in the
 * ledger, with the `ticket` it was for when there is one. `signal` ends the call early (the caller's timeout or
 * a cancel). `spend`, if given, is filled in with the cost, for callers that only get the parsed answer back
 * (quickJson). Returns { text, lane, model, usd, estUsd }, or null when there is no answer (no key, no room,
 * an error): every caller has a plain fallback.
 */
export async function quick(
  office,
  {
    system,
    user,
    model,
    maxTokens = 400,
    agent = 'router',
    dept = 'exec',
    phase = 'quick',
    effort,
    history = [],
    signal,
    ticket = '',
    spend,
  },
) {
  if (modelsOff(office)) return null; // the demo and the tests: never a real model call
  if (signal?.aborted) return null;
  const { modelId } = await import('../company/model.mjs');
  const m = modelId(model || office.cfg.routing?.model || 'sonnet');
  const room = office.ledger.room(agent, office.company.agent(agent)?.budgetUsd ?? office.ledger.defaultAgentUsd);
  if (!secret('ANTHROPIC_API_KEY') || office.lanes.state().apiDown || room.office <= 0) return null;
  try {
    const body = {
      model: m,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
      messages: [...history, { role: 'user', content: user }],
    };
    if (effort && !/haiku/.test(m)) body.output_config = { effort };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': secret('ANTHROPIC_API_KEY'),
      },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
    });
    const j = await res.json();
    if (!res.ok) {
      const kind = classifyApiError(j.error?.message || '', res.status);
      if (kind === 'billing' || kind === 'auth') office.lanes.apiDown(j.error?.message || `HTTP ${res.status}`);
      return null;
    }
    const { priceOf } = await import('./messages.mjs');
    const usd = priceOf(m, j.usage);
    office.ledger.record({
      agent,
      dept,
      lane: 'api',
      engine: 'oneshot',
      model: m,
      phase,
      usd,
      estUsd: usd,
      ms: 0,
      ...(ticket ? { ticket } : {}),
    });
    if (spend) {
      spend.usd = (spend.usd || 0) + usd;
      spend.estUsd = (spend.estUsd || 0) + usd;
    }
    return {
      text: (j.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim(),
      lane: 'api',
      model: m,
      usd,
      estUsd: usd,
    };
  } catch {
    return null;
  }
}
/** A quick call that answers in JSON. Returns the parsed object or null. */
export async function quickJson(office, opts) {
  const r = await quick(office, opts);
  return r ? parseJson(r.text) : null;
}
function parseJson(s) {
  const m = String(s).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}
