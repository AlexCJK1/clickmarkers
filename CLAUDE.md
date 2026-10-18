# Nightdesk: working on this repo

Nightdesk is an AI marketing agency of desks that runs on the owner's own computer. Read `ARCHITECTURE.md`
first (how the parts fit) and `SECURITY.md` (what keeps it safe). Both are kept current.

## Rules of the house (for any agent or person editing this code)
- British English, no em dashes, short sentences. Comments say why, not what.
- Plain Node (ESM, Node 22+), no framework on the server, no native modules; the same code runs on Windows,
  macOS, Linux and a VPS.
- Every Anthropic call is billed to the owner's API key. Never add a path that runs on a Claude subscription
  login (claude.ai OAuth, the CLI's own login, `settingSources: ['user']`): products built on the Agent SDK
  may not offer it.
- Secrets never enter the repo, the logs or a prompt. They live in the secrets file named in
  `office.config.local.json` and reach only the process that needs them (`core/secrets.mjs`); stdio
  connectors start through `core/clean-env.mjs`.
- The codebase is neutral: the example company (`company/`, `examples/brain/`) is made up. No real business,
  person or client data, ever.
- Nothing is sent, posted, scheduled or spent by a desk without the owner's OK. The draft phase refuses
  outbound tools in code (`toolGate`, `outboundTool`); the execute phase runs only the frozen draft, only
  the tools its steps call, only with the addresses and links it holds. Do not weaken any of it.
- Every behaviour change ships with a test in `test/` (`npm test`, node:test, no network). A change to the
  gate, the prompts, the guard, the server's checks or the secrets handling also gets a test in
  `test/security.test.mjs`.
- Prompt caching: keep `systemPrompt()` byte-stable per desk and phase. Anything per-run goes in `userPrompt()`.

## Where things are
- `company/company.json`: the org chart, briefs, budgets, connectors per desk. `routines.json`: the clock.
  `workflows.json`: named chains. `connectors.json`: the registry (read-only lists, outbound rules,
  `private` and `web` flags).
- `engines/`: `agent.mjs` (Agent SDK, the permission gate), `messages.mjs` (direct API, oneshot and batch),
  `openrouter.mjs`, `prompt.mjs`, `office-tools.mjs` (in-process MCP: brain, tickets, delegate, files),
  `connectors.mjs`, `health.mjs`, `index.mjs` (engine dispatch, `quick()`).
- `core/`: config, secrets, store, clock, events, ledger, lanes (API room: key, ceiling, budget), guard.
- `company/evals.mjs`: the evaluations step between a draft and the owner.
- `io/`: `server.mjs` (API, SSE, static, the token check), `telegram.mjs` (the phone).
- `ui/`: the page (Vite + React + Tailwind + Three.js), built by `npm run build` into `web/dist/` (not in git).
- `servers/`: the office's own MCP servers: `mail.mjs` (IMAP), `google.mjs` + `google-tools.mjs`.
- `bin/nightdesk.mjs`: demo, serve, check, run, tickets, ledger, routines, connect.
- `scripts/`: the demo seed and show, the Windows start scripts, the fixtures server, tools.

## Commands
```
npm test                      # unit tests, no network (NIGHTDESK_NO_MODELS=1, NIGHTDESK_NO_LOCAL=1)
npm run demo:show             # the made-up office on 127.0.0.1:4600, nothing runs
npm run check                 # what is configured
node bin/nightdesk.mjs run "DESIGN: …"   # one ticket, waits, prints the bill
npm start                     # the office
```
