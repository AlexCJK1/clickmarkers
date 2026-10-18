// The agent engine: one Claude Agent SDK session per ticket run. Full tool use (the desk's connectors,
// the office tools, the web when allowed, its team as sub-agents) with the harness's own prompt
// caching. Billed to the owner's API key, which goes into the child's environment and nowhere else (the
// connectors it starts get a clean environment of their own: core/clean-env.mjs).
import path from 'node:path';
import fs from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { modelId, routable } from '../company/model.mjs';
import { systemPrompt, userPrompt, approvedSteps, runsOnWeb } from './prompt.mjs';
import { namedIn, unapprovedTarget } from './connectors.mjs';
import { officeServer } from './office-tools.mjs';
import { redact, secret } from '../core/secrets.mjs';
import { classifyApiError } from '../core/lanes.mjs';

const BUILTIN_DENY = ['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'NotebookEdit', 'MultiEdit', 'KillShell', 'BashOutput'];

function childEnv(cfg, secrets = {}) {
  const env = { ...process.env, ...secrets }; // the connectors' secrets ride here, never on the command line
  delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; delete env.CLAUDE_CODE_OAUTH_TOKEN;
  env.ANTHROPIC_API_KEY = secret('ANTHROPIC_API_KEY'); // always the API key: never a subscription login
  env.CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS = '1';
  // Tool search: MCP schemas load on demand instead of sitting in every prompt. Measured on the PC:
  // Meta's 97 tools are 224k tokens upfront and 417 with tool search on.
  env.ENABLE_TOOL_SEARCH = String(cfg.lanes.toolSearch ?? 'true');
  if (cfg.lanes.maxToolDescription) env.CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH = String(cfg.lanes.maxToolDescription);
  return env;
}

/**
 * Run one phase of a ticket on a desk. Resolves to
 * { ok, text, error, kind, cost: { usd, estUsd, tokens }, timings: { bootMs, modelMs, totalMs }, calls, mcp, model, lane, turns }
 */
export async function runAgent({ office, ticket, agent, phase, lane = 'api', capUsd, childResults = [], signal }) {
  const { cfg, company, vault, connectors, events } = office;
  const t0 = Date.now();
  // with no key, Claude Code would fall back to a login stored on the machine: never start it without one
  if (!secret('ANTHROPIC_API_KEY')) return { ok: false, text: '', error: 'no ANTHROPIC_API_KEY in the secrets file', kind: 'config', cost: { usd: 0, estUsd: 0, tokens: {} }, timings: { bootMs: 0, modelMs: 0, totalMs: 0 }, calls: [], mcp: [], model: '', lane, turns: 0, missing: [], denied: [], refused: true };
  const timings = { bootMs: 0, modelMs: 0, totalMs: 0 };
  const calls = []; const mcp = [];
  const usable = connectors.usable(agent.tools || []);
  const { server: office_, names: officeNames } = officeServer({ office, ticket, agent, phase });
  const mcpServers = { ...connectors.sdkServers(usable.keys), office: office_ };
  const exec = phase === 'execute';
  // after the OK no web search: the run carries out the named steps, and the gate holds every connector call to the
  // places in the approved draft
  const tools = [...(agent.web && !exec ? ['WebSearch', 'WebFetch'] : []), ...(teamOf({ company, agent }).length ? ['Agent'] : [])];
  const known = office.health_?.known?.() || {};
  const excluded = connectors.excluded(usable.keys, agent.toolsOnly || {}, known);
  // Before the OK the gate refuses every outbound call; after it, every call the approved steps do not name. The
  // known names it would refuse are also listed as denied, because deny rules win over any allow rule a user
  // setting might carry (a run that loads the owner's own settings).
  const approved = exec ? approvedSteps(ticket) : '';
  const outboundKnown = runKeys({ connectors, company, agent }).flatMap(k => (known[k] || connectors.get(k)?.known || []).filter(n => (exec ? !namedIn(approved, n) : connectors.outboundTool(k, n))).map(n => `mcp__${connectors.toolId(k)}__${n}`));
  const disallowedTools = [...new Set([...BUILTIN_DENY, ...excluded, ...outboundKnown])];
  const denied = [];
  const agents = {};
  for (const a of teamOf({ company, agent })) {
    const id = a.id;
    const sub = connectors.usable(a.tools || []).keys;
    for (const k of sub) if (!mcpServers[k]) Object.assign(mcpServers, connectors.sdkServers([k]));
    // A team member that reaches the open web does not get the brain: a page it reads could otherwise have it put
    // the notes into an address it opens. Its lead hands it what it needs in the brief.
    const onWeb = !!a.web || sub.some(k => connectors.get(k)?.web);
    const reads = onWeb ? ' Your lead gives you the facts you need in the brief; you have no access to the notes.' : (a.reads || []).length ? ` Your standing notes: ${a.reads.join(', ')} (read them with mcp__office__brain_read before you answer; brain_read("list") names every note).` : ' Read any note you need with mcp__office__brain_read.';
    agents[id] = { description: a.does || a.role, prompt: `You are ${a.name}, ${a.role} at ${company.name}. ${a.does || ''} ${a.brief || ''}${reads} Plain text, British English, no em dashes. Never send, publish or spend; write what you would do under AFTER YOUR OK.`, tools: [...sub.map(k => `mcp__${connectors.toolId(k)}__*`), ...(onWeb ? [] : ['mcp__office__brain_read']), ...(a.web ? ['WebSearch', 'WebFetch'] : [])], model: shortModel(a.model) };
  }
  const canUseTool = toolGate({ connectors, keys: runKeys({ connectors, company, agent }), own: usable.keys, team: Object.keys(agents), phase, approved, draft: exec ? String(ticket.approvedDraft || '') : '', builtin: tools, onDeny: (name, why) => { denied.push(name); events.emit('deny', { ticket: ticket.id, agent: agent.id, tool: name, why }); } });
  const runDir = path.join(cfg.data, 'runs'); fs.mkdirSync(runDir, { recursive: true });
  const model = modelId(ticket.model || agent.model);
  const system = systemPrompt({ company, agent, connectors, vault, officeTools: officeNames, phase });
  const user = userPrompt({ ticket, phase, vault, tickets: office.tickets, events: office.events, tz: cfg.timezone, statsFile: cfg.stats?.file, childResults, web: runsOnWeb({ agent, company, connectors }) });
  const abort = new AbortController();
  if (signal) signal.addEventListener('abort', () => abort.abort(), { once: true });

  let text = '', result = null, error = '', kind = '';
  try {
    const q = query({ prompt: user, options: {
      model, ...((ticket.effort || agent.effort) ? { effort: ticket.effort || agent.effort } : {}), systemPrompt: system, mcpServers, strictMcpConfig: true, settingSources: [], tools, disallowedTools, canUseTool, hooks: { PreToolUse: agentHook(canUseTool) },
      // no setting on the machine (the owner's own Claude Code allow rules) may let a call skip the gate
      managedSettings: { allowManagedPermissionRulesOnly: true },
      agents: Object.keys(agents).length ? agents : undefined, permissionMode: 'default', maxTurns: cfg.lanes.maxTurns || 40,
      maxBudgetUsd: capUsd > 0 ? capUsd : undefined, cwd: runDir, env: childEnv(cfg, connectors.secretEnv(Object.keys(mcpServers).filter(k => k !== 'office'))), abortController: abort,
      ...(cfg.lanes.claudePath ? { pathToClaudeCodeExecutable: cfg.lanes.claudePath } : {}),
    } });
    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') {
        timings.bootMs = Date.now() - t0;
        for (const s of m.mcp_servers || []) { mcp.push({ name: s.name, status: s.status }); if (s.status !== 'connected') events.emit('mcp', { ticket: ticket.id, agent: agent.id, server: s.name, status: s.status }); }
        events.emit('run', { ticket: ticket.id, agent: agent.id, stage: 'booted', bootMs: timings.bootMs, model, lane, mcp, toolsInContext: (m.tools || []).length, excluded: excluded.length });
      } else if (m.type === 'system' && m.subtype === 'api_retry') {
        events.emit('run', { ticket: ticket.id, agent: agent.id, stage: 'retry', error: m.error, attempt: m.attempt });
        if (m.error === 'billing_error' || m.error === 'authentication_failed') kind = m.error === 'billing_error' ? 'billing' : 'auth';
      } else if (m.type === 'assistant') {
        for (const b of m.message?.content || []) {
          if (b.type === 'tool_use') {
            const [, server, toolName] = String(b.name).match(/^mcp__(.+?)__(.+)$/) || [null, b.name === 'Agent' ? 'team' : 'claude', b.name];
            const c = { at: Date.now() - t0, server, tool: toolName, sub: m.parent_tool_use_id ? true : false };
            calls.push(c); events.emit('call', { ticket: ticket.id, agent: agent.id, ...c });
          } else if (b.type === 'text' && b.text) events.emit('say', { ticket: ticket.id, agent: agent.id, text: String(b.text).slice(0, 300), sub: !!m.parent_tool_use_id });
        }
      } else if (m.type === 'result') {
        result = m;
        timings.modelMs = m.duration_api_ms || 0;
        if (m.subtype === 'success') text = String(m.result || '').trim();
        if (m.is_error || m.subtype !== 'success') { error = (m.errors && m.errors.join('; ')) || m.result || m.subtype; kind = kind || classifyApiError(error, m.api_error_status) || (m.subtype === 'error_max_budget_usd' ? 'budget' : m.subtype === 'error_max_turns' ? 'turns' : 'run'); }
      }
    }
  } catch (e) {
    error = redact(e.message || String(e)); kind = kind || classifyApiError(error) || (abort.signal.aborted ? 'cancelled' : 'spawn');
  }
  timings.totalMs = Date.now() - t0;
  const usage = result?.usage || {};
  const est = +result?.total_cost_usd || 0;
  const cost = { usd: est, estUsd: est, tokens: { in: usage.input_tokens || 0, out: usage.output_tokens || 0, cacheRead: usage.cache_read_input_tokens || 0, cacheWrite: usage.cache_creation_input_tokens || 0 } };
  if (!text && !error) error = 'the run ended without a result';
  return { ok: !!text && !error, text, error: redact(error), kind, cost, timings, calls, mcp, model, lane, turns: result?.num_turns || 0, missing: usable.missing, denied };
}
/** Every connector a run can reach: the desk's own and its team members' (they run inside the same session). */
export function runKeys({ connectors, company, agent }) {
  const keys = [...connectors.usable(agent.tools || []).keys];
  for (const a of teamOf({ company, agent })) for (const k of connectors.usable(a.tools || []).keys) if (!keys.includes(k)) keys.push(k);
  return keys;
}
/** The desks a lead may run as sub-agents: its team, leaving out ids that are not desks and desks that take no jobs (the evaluations desk). */
export function teamOf({ company, agent }) { return (agent.team || []).map(id => company.agent(id)).filter(a => a && routable(a)); }
/**
 * The permission gate for one run, decided per call (deterministic, globs included).
 *  - Who may call what: the desk itself its own connectors and the office tools; a team member (a call made inside a
 *    sub-agent) the team's connectors. So a lead never reaches a team member's browser from its own context.
 *  - Before the owner's OK (draft and wrap): every outbound tool is refused (listed as outbound, named like one, or
 *    off a read-only list).
 *  - After it (execute): a tool runs only when the approved steps name it as a call, and an outbound one only with
 *    email addresses and links the frozen draft holds.
 *  - Everything else is refused. Nothing is pre-approved and nothing prompts.
 */
export function toolGate({ connectors, keys = [], own = [], team = [], phase, approved = '', draft = '', builtin = [], onDeny = () => {} }) {
  const byId = new Map(keys.map(k => [connectors.toolId(k), k])); byId.set('office', null);
  const lead = new Set([...own.map(k => connectors.toolId(k)), 'office']);
  const builtins = new Set(builtin); if (builtins.has('Agent')) builtins.add('Task'); // Claude Code's older name for the same tool
  return async (name, input, opts = {}) => {
    const mm = String(name).match(/^mcp__(.+?)__(.+)$/);
    const mine = !!mm && byId.has(mm[1]) && (!!opts?.agentID || lead.has(mm[1]));
    const outbound = mine && mm[1] !== 'office' && connectors.outboundTool(byId.get(mm[1]), mm[2]);
    let why = '';
    if (!mm) {
      if (!builtins.has(name)) why = 'not on this desk';
      // the Agent tool starts the desk's own team only: never Claude Code's built-in helpers, which would get every tool
      else if (['Agent', 'Task'].includes(name) && !team.includes(String(input?.subagent_type || ''))) why = `${input?.subagent_type || 'that helper'} is not on this desk's team`;
    }
    else if (!mine) why = 'not on this desk';
    else if (phase === 'execute') {
      // every connector call after the OK, reads too: a browser step approved once must not open another address
      const target = mm[1] !== 'office' ? unapprovedTarget(input, draft) : '';
      if (!namedIn(approved, mm[2])) why = 'not named in the approved steps';
      else if (target) why = `${target} is not in the approved draft`;
    } else if (outbound) why = `outbound in the ${phase} phase`;
    if (why) {
      onDeny(name, why);
      const message = !mm ? `${name}: ${why}.` : why === 'not on this desk' ? `${name} is not on this desk.` : phase === 'execute' ? `Refused: ${why}. Nothing was sent; report it instead.` : `${mm[2]} sends or changes something: write it under AFTER YOUR OK instead; it runs after the owner's OK.`;
      return { behavior: 'deny', message };
    }
    return { behavior: 'allow', updatedInput: input };
  };
}
/**
 * The gate again, as a PreToolUse hook for the Agent and Task tools. Claude Code lets those start without asking
 * canUseTool, so without this its own helpers (general-purpose and the rest) would start with every tool in the run.
 */
export function agentHook(gate) {
  return [{ matcher: 'Agent|Task', hooks: [async input => {
    if (input?.hook_event_name !== 'PreToolUse') return {};
    const r = await gate(input.tool_name, input.tool_input, { agentID: input.agent_id });
    return r.behavior === 'deny' ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r.message } } : {};
  }] }];
}
const shortModel = m => (['opus', 'sonnet', 'haiku'].includes(m) ? m : modelId(m));
