# AGENTS.md

Instructions for any coding agent working in this repository. `CLAUDE.md` is the full version; this file
carries the same rules for tools that read AGENTS.md.

- Read `ARCHITECTURE.md` before changing the frame (company, tickets, engines, lanes, ledger) and
  `SECURITY.md` before touching the gate, the prompts, the guard or the server.
- Run `npm test` before and after a change. Add a test for every behaviour change; security changes go in
  `test/security.test.mjs`.
- Never commit secrets, `office.config.local.json`, `data/` or `.demo/`. No real business data.
- British English, no em dashes. Plain Node ESM, no native modules, no server framework.
- A desk never gets `Bash`, `Edit`, `Write` or `Read`; the office tools are the only path to files.
- The owner approves anything outbound. Do not weaken the draft and execute split.
- Every Anthropic call uses the owner's API key. Never add a subscription-login path.
