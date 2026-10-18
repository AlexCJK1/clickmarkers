---
name: office-ops
description: Add or change a desk, a connector, a routine or a workflow in Nightdesk; use when the owner asks for a new agent, a new tool on a desk, a scheduled job, or a chain of desks.
---

# Office operations

## Add a desk
1. `company/company.json` → `agents[]`: `id` (short, lower case), `name` (the sign on the door, upper
   case), `role`, `dept` (an id from `departments`), `model` (`opus` for desks that think, `sonnet` for
   routing and read-only digests), `tools` (keys from `connectors.json`), `web`, `office` (tool names from
   `engines/office-tools.mjs`), `team` (desk ids it may run as sub-agents), `reads` (standing notes),
   `skills` (folders under `<brain>/skills`), `budgetUsd`, `outbound` (true when its tools can send or
   change things), `does` (one line), `brief` (the standing instructions).
2. A lead gets `office: [..., "delegate", "tickets_recent"]` and a `team`. `desk_note` (the desk writes its
   own notebook) is opt-in; leave it off desks that read mail or the web. Do not put a desk that browses on
   the team of a desk that reads private material: hand it work as a ticket with `delegate` instead.
3. `npm test` (the company test validates the chart) and `node bin/nightdesk.mjs check`.

## Add a connector
1. `company/connectors.json`: `{ "label", "type": "http" | "sse" | "stdio", "url" or
   "command"+"args", "headers": { "Authorization": "Bearer ${SECRET_NAME}" }, "auth", "readOnly": [the
   only tool names that may run before the owner's OK], "outbound": [tool name globs that send or change
   things], "private": true (it reads the owner's own material: mail, files, a CRM), "web": true (it
   reaches the open web), "verified", "disabled", "notes" }`.
2. Give it a `readOnly` list whenever you can. Without one, a tool runs before the OK only when its name
   plainly says it reads (`get_`, `list_`, `search_` ...); everything else waits for the OK.
3. Pin every `npx` or `pipx` server to a version. Stdio servers start through `core/clean-env.mjs`, so they
   see only their own `env` names and the basics, never the office's keys.
4. claude.ai's own connectors cannot be used (they need a Claude subscription login): use the service's own
   remote MCP server, or a stdio one.
5. Put the secret in the owner's secrets file; never in the repo. `node bin/nightdesk.mjs check` reports
   what is missing, and names any desk whose runs would read private material and reach the web.
6. Add the key to the desks that need it. A desk's connectors are the only servers its runs can see.

## Add a routine
`company/routines.json`: `{ "id", "dept", "agent", "title", "text", "when": { "kind": "daily" | "weekly" |
"weekdays" | "hourly" | "every", "at": "HH:MM", "days": [0..6], "minutes" }, "needsOk", "paused", "model",
"engine" }`. `engine: "batch"` sends it to the Batch API (half price, inside the hour) when it needs no tools.

## Add a workflow
`company/workflows.json`: `{ "<name>": { "title", "owner": "<lead id>", "text", "steps": [ { "id", "agent",
"title", "text", "after": ["<step id>"], "needsOk", "model", "engine" } ] } }`. `{topic}` is filled from the
request. The owner runs it as `<name>: <topic>` on the phone, the page or the CLI.

## Check
`npm test`, then `node bin/nightdesk.mjs check`.
