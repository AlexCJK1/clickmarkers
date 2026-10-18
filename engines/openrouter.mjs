// The other-models engine: one job to a model that is not Claude, through the OpenAI-compatible chat endpoint. By
// default that is OpenRouter (GPT, Gemini, Llama and the rest); `openrouter.baseUrl` points it at any other
// compatible service instead: OpenAI, Gemini's compatible endpoint, or a model on this machine (Ollama, LM Studio).
// Single shot, no tools: it writes drafts, captions, translations and sorting. Anything that sends runs on the agent
// engine after the owner's OK, never here.
import { secret, redact } from '../core/secrets.mjs';
import { systemPrompt, userPrompt } from './prompt.mjs';

const OPENROUTER = 'https://openrouter.ai/api/v1';
const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/i;
const isClaude = m => !m || /^(opus|sonnet|haiku)$/i.test(m) || /^claude/i.test(m);

/**
 * Where the engine sends a job and whether it can. A key goes only where it belongs: the OpenRouter key only to
 * OpenRouter, another service's key only when `openrouter.keyName` names it, and none to a model on this machine
 * unless named. A service elsewhere must use https, so a prompt never crosses the network in the clear.
 */
export function otherModels(cfg = {}) {
  const o = cfg.openrouter || {};
  const base = String(o.baseUrl || OPENROUTER).replace(/\/+$/, '');
  let host = '';
  let https = false;
  try {
    const u = new URL(base);
    host = u.hostname;
    https = u.protocol === 'https:';
  } catch {
    // an address that does not parse is not ready, below
  }
  const openrouter = host === 'openrouter.ai';
  const local = LOOPBACK.test(host);
  const keyName = o.keyName || (openrouter ? 'OPENROUTER_API_KEY' : '');
  const key = keyName ? secret(keyName) : '';
  const why = !host
    ? `openrouter.baseUrl is not an address: ${base}`
    : !local && !https
      ? `openrouter.baseUrl must use https unless it is on this machine: ${base}`
      : !local && !key
        ? keyName
          ? `no ${keyName} in the secrets file`
          : "set openrouter.keyName to the secret that holds this service's key"
        : '';
  return {
    url: `${base}/chat/completions`,
    host,
    keyName,
    key,
    local,
    openrouter,
    ready: !why,
    why,
    lane: openrouter ? 'openrouter' : local ? 'local' : 'other',
    model: o.model || (openrouter ? 'openai/gpt-5-mini' : ''),
    price: o.price || null,
  };
}

export async function runOpenRouter({ office, ticket, agent, phase, childResults = [], signal }) {
  const t0 = Date.now();
  const om = otherModels(office.cfg);
  const pick = m => (m && !isClaude(m) ? m : '');
  const model = pick(ticket.model) || pick(agent.model) || om.model;
  const empty = { usd: 0, estUsd: 0, tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 } };
  const failed = (error, kind, ms = 0) => ({
    ok: false,
    text: '',
    error,
    kind,
    cost: empty,
    timings: { bootMs: 0, modelMs: 0, totalMs: ms },
    calls: [],
    mcp: [],
    model,
    lane: om.lane,
    turns: 0,
    missing: [],
  });
  if (!om.ready) return failed(om.why, 'auth');
  if (!model) return failed("no model named: set openrouter.model or the desk's model", 'config');
  const { cfg, company, vault, connectors } = office;
  const system = systemPrompt({ company, agent, connectors, vault, officeTools: [] });
  const user = userPrompt({
    ticket,
    phase,
    vault,
    tickets: office.tickets,
    events: office.events,
    tz: cfg.timezone,
    statsFile: cfg.stats?.file,
    childResults,
  });
  try {
    const res = await fetch(om.url, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        ...(om.key ? { authorization: `Bearer ${om.key}` } : {}),
        ...(om.openrouter
          ? { 'HTTP-Referer': 'https://github.com/AlexCJK1/clickmarkers', 'X-Title': company.name }
          : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        // OpenRouter's own fields; another service may refuse a field it does not know
        ...(om.openrouter ? { usage: { include: true } } : {}),
        ...(om.openrouter && cfg.openrouter?.fallbacks ? { models: cfg.openrouter.fallbacks, route: 'fallback' } : {}),
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok)
      return failed(
        redact(j.error?.message || `HTTP ${res.status}`),
        res.status === 401 || res.status === 402 ? 'auth' : 'api',
        Date.now() - t0,
      );
    const text = String(j.choices?.[0]?.message?.content || '').trim();
    const u = j.usage || {};
    // OpenRouter reports the cost; another service is priced from openrouter.price (USD per million tokens), else 0
    const usd =
      +u.cost ||
      (om.price
        ? ((u.prompt_tokens || 0) * (+om.price.inPerM || 0) + (u.completion_tokens || 0) * (+om.price.outPerM || 0)) /
          1e6
        : 0);
    return {
      ok: !!text,
      text,
      error: text ? '' : 'empty answer',
      kind: text ? '' : 'run',
      cost: {
        usd,
        estUsd: usd,
        tokens: {
          in: u.prompt_tokens || 0,
          out: u.completion_tokens || 0,
          cacheRead: u.prompt_tokens_details?.cached_tokens || 0,
          cacheWrite: 0,
        },
      },
      timings: { bootMs: 0, modelMs: Date.now() - t0, totalMs: Date.now() - t0 },
      calls: [],
      mcp: [],
      model: j.model || model,
      lane: om.lane,
      turns: 1,
      missing: [],
    };
  } catch (e) {
    return failed(redact(e.message), 'network', Date.now() - t0);
  }
}
