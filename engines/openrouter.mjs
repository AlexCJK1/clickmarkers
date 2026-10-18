// The OpenRouter engine: any model on OpenRouter through the OpenAI-compatible endpoint, for the desks
// below the Anthropic head (cheap drafts, translations, classification). Single shot, no tools yet;
// cost comes back in the response when usage accounting is on.
import { secret, redact } from '../core/secrets.mjs';
import { systemPrompt, userPrompt } from './prompt.mjs';

const URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function runOpenRouter({ office, ticket, agent, phase, childResults = [], signal }) {
  const t0 = Date.now();
  const key = secret('OPENROUTER_API_KEY');
  const model = ticket.model && ticket.model.includes('/') ? ticket.model : (agent.model.includes('/') ? agent.model : (office.cfg.openrouter?.model || 'openai/gpt-5-mini'));
  const empty = { usd: 0, estUsd: 0, tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 } };
  if (!key) return { ok: false, text: '', error: 'no OPENROUTER_API_KEY', kind: 'auth', cost: empty, timings: { bootMs: 0, modelMs: 0, totalMs: 0 }, calls: [], mcp: [], model, lane: 'openrouter', turns: 0, missing: [] };
  const { cfg, company, vault, connectors } = office;
  const system = systemPrompt({ company, agent, connectors, vault, officeTools: [] });
  const user = userPrompt({ ticket, phase, vault, tickets: office.tickets, events: office.events, tz: cfg.timezone, statsFile: cfg.stats?.file, childResults });
  try {
    const res = await fetch(URL, { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://github.com/AlexCJK1/nightdesk', 'X-Title': company.name },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], usage: { include: true }, ...(cfg.openrouter?.fallbacks ? { models: cfg.openrouter.fallbacks, route: 'fallback' } : {}) }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, text: '', error: redact(j.error?.message || `HTTP ${res.status}`), kind: res.status === 401 || res.status === 402 ? 'auth' : 'api', cost: empty, timings: { bootMs: 0, modelMs: 0, totalMs: Date.now() - t0 }, calls: [], mcp: [], model, lane: 'openrouter', turns: 0, missing: [] };
    const text = String(j.choices?.[0]?.message?.content || '').trim();
    const u = j.usage || {}; const usd = +u.cost || 0;
    return { ok: !!text, text, error: text ? '' : 'empty answer', kind: text ? '' : 'run', cost: { usd, estUsd: usd, tokens: { in: u.prompt_tokens || 0, out: u.completion_tokens || 0, cacheRead: u.prompt_tokens_details?.cached_tokens || 0, cacheWrite: 0 } }, timings: { bootMs: 0, modelMs: Date.now() - t0, totalMs: Date.now() - t0 }, calls: [], mcp: [], model: j.model || model, lane: 'openrouter', turns: 1, missing: [] };
  } catch (e) { return { ok: false, text: '', error: redact(e.message), kind: 'network', cost: empty, timings: { bootMs: 0, modelMs: 0, totalMs: Date.now() - t0 }, calls: [], mcp: [], model, lane: 'openrouter', turns: 0, missing: [] }; }
}
