// Diagnostic: how many tokens a connector's tool schemas cost per run, under three settings. One tiny
// Haiku session each, no work done. Usage: node scripts/measure-tools.mjs <connector key> [more keys]
import { query } from '@anthropic-ai/claude-agent-sdk';
import { loadConfig } from '../core/config.mjs';
import { loadSecrets, secret } from '../core/secrets.mjs';
import { Connectors } from '../engines/connectors.mjs';

const cfg = loadConfig();
loadSecrets(cfg.secretsFile);
const connectors = new Connectors(cfg.connectors);
const keys = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!keys.length) {
  console.error('give connector keys');
  process.exit(2);
}
if (!secret('ANTHROPIC_API_KEY')) {
  console.error('needs ANTHROPIC_API_KEY in the secrets file (each check is a tiny session on the API)');
  process.exit(2);
}
const variants = [
  ['default', {}],
  ['ENABLE_TOOL_SEARCH=true', { ENABLE_TOOL_SEARCH: 'true' }],
  ['ENABLE_TOOL_SEARCH=auto:3', { ENABLE_TOOL_SEARCH: 'auto:3' }],
  ['MAX_MCP_DESCRIPTION_LENGTH=500', { CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH: '500' }],
  ['ENABLE_TOOL_SEARCH=false', { ENABLE_TOOL_SEARCH: 'false' }],
];
for (const [label, extra] of variants) {
  const env = { ...process.env, ...extra };
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  env.ANTHROPIC_API_KEY = secret('ANTHROPIC_API_KEY');
  const t0 = Date.now();
  let init = null,
    res = null;
  try {
    for await (const m of query({
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
      },
    })) {
      if (m.type === 'system' && m.subtype === 'init') init = m;
      if (m.type === 'result') res = m;
    }
  } catch (e) {
    console.log(label, 'failed:', e.message.slice(0, 120));
    continue;
  }
  const u = res?.usage || {};
  const toolNames = init?.tools || [];
  const want = keys.map(k => connectors.toolId(k));
  const present = (init?.mcp_servers || [])
    .filter(x => want.includes(String(x.name).replace(/[^A-Za-z0-9_-]+/g, '_')))
    .map(x => `${x.name}:${x.status}`);
  console.log(`   servers ${init?.mcp_servers?.length ?? 0} loaded; wanted: ${present.join(', ') || 'none present'}`);
  console.log(
    `${label.padEnd(32)} tools in context ${String(toolNames.length).padStart(4)} (ToolSearch ${toolNames.includes('ToolSearch') ? 'yes' : 'no'})  cacheWrite ${String(u.cache_creation_input_tokens || 0).padStart(7)}  cacheRead ${String(u.cache_read_input_tokens || 0).padStart(7)}  in ${u.input_tokens || 0}  est $${(+res?.total_cost_usd || 0).toFixed(4)}  ${Date.now() - t0} ms`,
  );
}
process.exit(0);
