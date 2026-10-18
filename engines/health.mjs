// Connector health: boot one tiny session per connector (Haiku, one turn, no work, on the API key) and
// read what the harness reports at init: connected, failed or needs-auth, and how many tools it offers.
// Results are kept in data/connectors-state.json so the page can draw the bar without a probe.
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { jsonFile } from '../core/store.mjs';
import { secret, redact } from '../core/secrets.mjs';
import { emit } from '../core/events.mjs';

export class ConnectorHealth {
  constructor(office) {
    this.office = office;
    this.store = jsonFile(path.join(office.cfg.data, 'connectors-state.json'), { servers: {} });
    this.state = this.store.read();
    this.busy = false;
  }
  view() {
    return this.office.connectors.view().map(c => ({
      ...c,
      health: this.state.servers[c.key] ? { ...this.state.servers[c.key], names: undefined } : null,
    }));
  }
  /** Tool names per connector as last probed. */
  known() {
    const out = {};
    for (const [k, v] of Object.entries(this.state.servers)) if (v.names?.length) out[k] = v.names;
    return out;
  }
  /** Probe every usable connector (or the keys given): one tiny session each, on the API key. */
  async probe(keys = null) {
    if (this.busy || this.office.cfg.demo) return this.view(); // the demo starts no connector and no session
    this.busy = true;
    try {
      const { connectors } = this.office;
      const all = keys || connectors.keys();
      const usable = connectors.usable(all);
      for (const k of all)
        if (!usable.keys.includes(k)) {
          const why = usable.missing.find(m => m.startsWith(k + ':')) || '';
          if (connectors.get(k)?.disabled) this.set(k, { status: 'off', tools: 0, note: 'disabled' });
          else if (why) this.set(k, { status: 'missing', tools: 0, note: why.split(': ')[1] || why });
        }
      // a check is a short session on the API: with no key there is nothing to check with (never a subscription login)
      if (!secret('ANTHROPIC_API_KEY')) {
        for (const k of usable.keys)
          this.set(k, { status: 'unchecked', tools: 0, note: 'no ANTHROPIC_API_KEY to check with' });
        this.store.write(this.state);
        return this.view();
      }
      for (const k of usable.keys) {
        if (connectors.get(k).type === 'inherit') {
          this.set(k, {
            status: 'off',
            tools: 0,
            note: 'claude.ai connectors need a subscription login; use the direct server',
          });
          continue;
        }
        await this.one([k]);
      }
      this.store.write(this.state);
      return this.view();
    } finally {
      this.busy = false;
    }
  }
  async one(keys) {
    const { connectors, cfg } = this.office;
    if (!secret('ANTHROPIC_API_KEY')) {
      for (const k of keys) this.set(k, { status: 'unchecked', tools: 0, note: 'no ANTHROPIC_API_KEY to check with' });
      return;
    } // never a stored login
    const env = { ...process.env, ...connectors.secretEnv(keys) };
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    env.ANTHROPIC_API_KEY = secret('ANTHROPIC_API_KEY');
    env.CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS = '1';
    const t0 = Date.now();
    const ids = Object.fromEntries(keys.map(k => [connectors.toolId(k), k]));
    try {
      const q = query({
        prompt: 'Reply with the single word OK.',
        options: {
          model: 'claude-haiku-5-5',
          systemPrompt: 'Answer OK.',
          mcpServers: connectors.sdkServers(keys),
          strictMcpConfig: true,
          settingSources: [],
          tools: [],
          maxTurns: 1,
          permissionMode: 'dontAsk',
          cwd: cfg.data,
          env,
          ...(cfg.lanes.claudePath ? { pathToClaudeCodeExecutable: cfg.lanes.claudePath } : {}),
        },
      });
      let seen = false;
      for await (const m of q) {
        if (m.type === 'system' && m.subtype === 'init') {
          seen = true;
          const counts = {},
            names = {};
          for (const t of m.tools || []) {
            const mm = String(t).match(/^mcp__(.+?)__(.+)$/);
            if (mm && ids[mm[1]]) {
              counts[ids[mm[1]]] = (counts[ids[mm[1]]] || 0) + 1;
              (names[ids[mm[1]]] = names[ids[mm[1]]] || []).push(mm[2]);
            }
          }
          for (const s of m.mcp_servers || []) {
            const key = ids[String(s.name).replace(/[^A-Za-z0-9_-]+/g, '_')] || (keys.includes(s.name) ? s.name : null);
            if (key)
              this.set(key, {
                status: s.status,
                tools: counts[key] || 0,
                ms: Date.now() - t0,
                names: names[key] || undefined,
              });
          }
          for (const k of keys)
            if (!this.state.servers[k] || this.state.servers[k].at < t0)
              this.set(k, { status: 'failed', tools: 0, note: 'no init status' });
          q.close?.();
          break;
        }
      }
      if (!seen) for (const k of keys) this.set(k, { status: 'failed', tools: 0, note: 'no init' });
    } catch (e) {
      for (const k of keys) this.set(k, { status: 'failed', tools: 0, note: redact(e.message).slice(0, 160) });
    }
  }
  set(key, h) {
    this.state.servers[key] = { ...h, at: Date.now() };
    emit('connector', { key, ...this.state.servers[key] });
  }
}
