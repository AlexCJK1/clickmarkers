// One tool call on one of the office's own stdio MCP servers, with no model in between. Used where a
// step is plain code: the page's "Refresh" on the numbers runs the stats job's refresh tool. The one call
// allowed is the one named in office.config.json as stats.refresh ({ connector, tool }); it must only
// rebuild the stats file and never send or change anything outside the machine.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

/** The direct calls this office allows: only the configured stats refresh. */
export const directCalls = cfg => { const r = cfg?.stats?.refresh; return new Set(r?.connector && r?.tool ? [`${r.connector}:${r.tool}`] : []); };
let busy = null;

/** Call `tool` on the stdio connector `key`. Resolves to { ok, text } or { ok: false, error }. One at a time. */
export async function callDirect(office, key, tool, args = {}, { timeoutMs = 120000 } = {}) {
  if (!directCalls(office.cfg).has(`${key}:${tool}`)) return { ok: false, error: `${key}.${tool} is not a direct call` };
  if (busy) return busy;
  busy = (async () => {
    const servers = office.connectors.sdkServers([key], { resolve: true }); const s = servers[key];
    if (!s || s.type !== 'stdio') return { ok: false, error: `${key} is not a usable stdio connector` };
    const transport = new StdioClientTransport({ command: s.command, args: s.args || [], env: { ...getDefaultEnvironment(), ...(s.env || {}) }, stderr: 'ignore' });
    const client = new Client({ name: 'nightdesk', version: '1' });
    const timer = setTimeout(() => transport.close().catch(() => {}), timeoutMs);
    try {
      await client.connect(transport);
      const r = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: timeoutMs });
      const text = (r.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
      return r.isError ? { ok: false, error: text.slice(0, 400) || 'the tool reported an error' } : { ok: true, text };
    } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 400) }; }
    finally { clearTimeout(timer); await client.close().catch(() => {}); }
  })().finally(() => { busy = null; });
  return busy;
}
