# IT office template

The same frame as the example marketing office, with engineering desks. To stand one up:

1. Copy this folder's three files over `company/` (or point `office.config.local.json` at them with
   `"company"`, `"routines"`, `"workflows"`).
2. Give it a brain: `10-Architecture/` (backend.md, frontend.md, data-model.md, conventions.md),
   `20-Design/`, `30-Quality/test-strategy.md`, `40-Platform/runbook.md` and environments.md,
   `50-Security/threat-model.md`, `60-Backlog/open-items.md`, `00-Meta/MOC-Engineering.md` and index.md.
3. Connectors: the desks name `github`, `vercel`, `supabase`, `sentry`, `figma-remote` and `browser-preview` (a browser kept to your own app: set its `--allowed-origins`).
   `github`, `figma-remote` and `browser-preview` are in `company/connectors.json` (switch `github` on and put a
   `GITHUB_PAT` in the secrets file). Add entries for `vercel`, `supabase` and `sentry` from their own MCP
   servers, each with a `readOnly` list, so merge, deploy and delete wait for your OK. `npm run check`
   names any desk tool that is not in the registry.
4. Desks that must edit code would need `Read`, `Edit` and `Bash` in a sandboxed checkout of their own.
   Nightdesk denies those tools to every desk by design, so for now the desks read and write through the
   GitHub connector (branches, files, pull requests), which is enough for small changes.
5. Workflows: `feature: <what>` and `incident: <what>`.

Everything else (the ledger, approvals, the phone, the page, the wire) is unchanged.
