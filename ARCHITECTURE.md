# Clickmarkers: architecture

How the parts fit together, how work moves, where the money is counted, and how the same frame runs a
different company. Kept current with the code. For the safety model in full, see `SECURITY.md`.

## 1. The idea in one paragraph

An owner types a job on the page, the phone or the command line. It becomes a ticket. A cheap router (or
the owner's own "DESIGN: …" prefix) puts it on a desk. A desk is a Claude session with a standing brief,
the company's notes, the connectors it is allowed and a daily budget. It does the work; anything that
would send, post, spend or change a live system is written up as a draft and waits for the owner's OK.
Leads delegate pieces to other desks as child tickets and get a wrap-up run when the children finish.
Routines fire tickets on a clock. Every run is a line in the ledger: desk, engine, model, dollars, billed
to the owner's Anthropic API key. When there is no room (the daily ceiling, the desk's budget, the API
resting after a billing error) the job waits; it is never moved to a Claude subscription, which products
built on the Agent SDK may not use.

## 2. The parts

```
owner ──page (web)────────┐                                ┌── connectors (MCP): Meta Ads, Canva, Figma,
      ──phone (Telegram)──┤                                │     Google, the mailbox, a browser, …
      ──CLI───────────────┤                                │
                          ▼                                ▼
                   ┌─────────────┐   ┌────────┐   ┌──────────────────────────────────────────────┐
  routines ──────▶ │   tickets   │──▶│ heart- │──▶│ engines: agent (Agent SDK, on the API key)    │
  (clock)          │  next→doing │   │  beat  │   │          oneshot (Messages API, cached)      │
                   │  →waiting…  │◀──│        │◀──│          batch (Message Batches, half price) │
                   └─────────────┘   └────────┘   │          openrouter (other vendors' models)  │
                          ▲                       └──────────────────────────────────────────────┘
                          │                                 │              │
                   ┌─────────────┐                   ┌──────────┐    ┌──────────┐
                   │   company   │                   │  ledger  │    │  brain   │
                   │ org chart,  │                   │ $ per run│    │ notes,   │
                   │ briefs,     │                   │ budgets, │    │ inbox,   │
                   │ budgets     │                   │ ceiling  │    │ stats    │
                   └─────────────┘                   └──────────┘    └──────────┘
```

| Part | File | What it holds |
|---|---|---|
| Company | `company/company.json` (the five-desk starter; `templates/agency` is the full example), `company/model.mjs` | name, business, mission, house rules, departments, every desk: role, who it reports to, model, engine, connectors, web, office tools, team, standing notes, budget |
| Tickets | `company/tickets.mjs` | the unit of work and its states; parents, children, `after` ordering; the archive |
| Routines | `company/routines.json`, `company/routines.mjs` | standing work on a clock; one firing per slot; no replay of a backlog |
| Workflows | `company/workflows.json`, `company/workflows.mjs` | named chains of desks, started as `new-post: <topic>` |
| Office | `company/office.mjs` | intake, routing, the heartbeat, runs, approvals, wrap-ups, the board controls |
| Brain | `brain/vault.mjs` | the owner's markdown notes, the drop folder (`90-Inbox`), the stats file, desk notebooks and lessons |
| Engines | `engines/*.mjs` | how a run is executed and billed (section 4) |
| Connectors | `company/connectors.json`, `engines/connectors.mjs` | the registry of outside tools by key; secrets as `${NAME}`; read-only lists and outbound rules |
| Office tools | `engines/office-tools.mjs` | the in-process MCP server a run gets: brain_read, brain_append, desk_note, ticket_note, delegate, tickets_recent, files_list, file_read |
| Prompts | `engines/prompt.mjs` | the stable system prompt (cached) and the per-run user prompt; the phase rules |
| Evaluations | `company/evals.mjs` | the check between a draft and the owner (section 3) |
| Ledger and lanes | `core/ledger.mjs`, `core/lanes.mjs` | spend by day, desk and lane; the ceiling, the per-desk budget, the per-run cap |
| Guard | `core/guard.mjs` | fences outside material and flags text that tries to give orders |
| Phone | `io/telegram.mjs` | jobs, results with pictures, APPROVE and REJECT, voice notes |
| Page | `io/server.mjs`, `ui/` → `web/dist` | the JSON API, the event stream, the page |
| CLI | `bin/clickmarkers.mjs` | demo, serve, check, run, tickets, ledger, routines, connect |

## 3. How work moves

```
 intake ─▶ next ─▶ doing ─┬─▶ done
                          ├─▶ waiting ─(APPROVE)─▶ doing (execute) ─▶ done
                          │            └(REJECT + note)─▶ next (draft again)
                          ├─▶ blocked ─(children closed)─▶ next (wrap) ─▶ doing ─▶ done
                          └─▶ failed ─(retry)─▶ next
```

- **Intake.** `"DESIGN: …"` names a desk, `"marketing: …"` a department, otherwise the router picks (one
  cheap call with JSON out). The owner's name for a desk always wins over the router.
- **Phases.** `draft` does the work and writes outbound steps under `AFTER YOUR OK`; `execute` carries out
  exactly those steps after the OK; `wrap` pulls the children's results together. A draft that ends with
  `NOTHING TO SEND` closes itself.
- **Evaluations.** A draft bound for the owner is checked first: code checks (an open code block, an
  outbound step with no `AFTER YOUR OK`), then one model check by the EVALUATIONS desk against the brief,
  the facts, the house rules and the owner's lessons. A fault goes back to the same desk (up to
  `evaluations.maxRounds`); a pass, the last round or no check at all (`unchecked`, it fails open) goes to
  the owner with the verdict on it. Em dashes are fixed by code before delivery. The evaluations desk
  never takes a job itself (`routable: false`).
- **The OK.** APPROVE is tied to a fingerprint of the draft the owner saw (the phone button carries it, the
  page sends it). The draft is frozen on the ticket and the execute run is given that frozen text and
  nothing else. A draft that changed since it was shown approves nothing.
- **Delegation.** A lead calls `delegate(to, title, text, after?)`; the child is a ticket with a parent;
  `after` makes it wait for a sibling and puts that result in front of it. The parent goes `blocked`,
  then gets a `wrap` run.
- **Teams.** A desk with a `team` runs those desks inside its own session as sub-agents, for small
  pieces of one run. Delegation is for pieces that deserve their own ticket, budget line and approval.
- **Threads.** Every ticket starts a thread; a reply is a new ticket on the same desk with the earlier
  exchanges in front of it. A reply or a rejection is also sorted for a lesson (a standing rule for the
  desk, or a one-off).
- **Heartbeat.** Every 15 s the office reloads changed files, fires due routines, polls and flushes
  batches, and starts queued tickets (`heartbeat.maxParallel` at once, one per desk).
- **Restart.** A draft caught mid-run goes back to `next`. An approved run caught mid-run fails with a
  warning instead, because some steps may already have gone out.

## 4. Engines and lanes

| Engine | What it is | Tools | Billing | Use it for |
|---|---|---|---|---|
| `agent` | a Claude Agent SDK session (Claude Code, headless) | connectors, office tools, web, team | API (the key in the child's environment only) | anything that needs tools or judgement; every approved run |
| `oneshot` | one Messages API call, prompt and tools cached for an hour | server-side web search and fetch; remote connectors through the API | API only | captions, rewrites, sorting |
| `batch` | the same request on the Message Batches API | as oneshot | API only, half price, usually answers within the hour, always within 24 hours | anything that can wait |
| `openrouter` | an OpenAI-compatible call: OpenRouter by default, or any compatible service set in `openrouter.baseUrl`, a local Ollama or LM Studio included | none | OpenRouter, that service, or nothing for a model on this machine | other vendors, local models, a second opinion |

**Room on the API** (`core/lanes.mjs`). A run starts only with an API key, the API not resting after a
billing or auth failure, the office under its daily ceiling and the desk under its budget; it gets a per-run
cap of `min(perRunUsd, room left)`. With no room the job waits (the heartbeat looks again later, and a desk
with no room never holds a slot another desk could use). With no key at all, a job fails with that reason.
Claude Code is always started with the key in its environment, never on a stored login. A `oneshot` call
that hits a billing or auth error rests the API like any other run. A failed `openrouter` call is not moved
anywhere: a desk the owner put on another model is never re-run on Claude. Its drafts still go to the evaluations
desk, which runs on Claude, and a job given without a desk's name is routed by Claude: set `evaluate: false`
on that desk and name it in the job to keep its work off Anthropic entirely. The owner's feedback on its work
is kept as written, never sorted by Claude.

**Prompt caching.** The system prompt is byte-identical across runs of a desk (company, desk, rules,
business note, standing notes, skills, lessons, in a fixed order). Everything that changes per run goes
in the user turn. On Opus and Sonnet 5.5 a cache read costs a twentieth of fresh input; on Haiku 5.5, a tenth.

**Tool search.** Connector schemas load on demand (`ENABLE_TOOL_SEARCH`). Measured in October 2026:
Meta's Ads server is 97 tools and about 224,000 tokens up front without it, and 417 tokens with it. A
registry entry's `only` list (or a desk's `toolsOnly`) trims a server further. `node scripts/measure-tools.mjs
<connector>` measures a connector on your own key (one tiny Haiku session per setting).

**Models.** `opus` for desks that think, `sonnet` for routing and digests, `haiku` for sorting lessons.
Any full model id works.

## 5. Money

- `ledger.ceilingUsd` per day for the whole office on the API.
- `budgetUsd` per desk per day; `perRunUsd` caps a single run.
- The phone hears when spend passes 50%, 80% and 100% of the ceiling.
- Reaching a limit makes new jobs wait until midnight (or until the owner raises it). Work in hand finishes.
  The owner stops work: pause a desk, pause the office, cancel a ticket.

## 6. Safety in the code

The full account is in `SECURITY.md`. Where each control lives:

- `engines/agent.mjs` `toolGate`: every tool call, decided in code. The desk's own servers and the office
  tools for the desk; the team's servers for its sub-agents; outbound tools refused before the OK; after
  it, only tools the approved steps call, every connector call only with addresses and links in the
  frozen draft, and a connector that holds its arguments (`verbatim`) only as one of the calls the steps
  write, each once. Claude Code starts its Agent tool without asking the gate, so `agentHook` runs the gate on
  it as a PreToolUse hook: only the desk's own team starts, never Claude Code's built-in helpers. The
  owner's own allow rules are switched off for office runs.
- `engines/connectors.mjs` `outboundTool`: a connector's `readOnly` list, else its `outbound` globs, else
  the tool's name (it reads only when a reading verb leads it, follows one prefix or ends it).
- `engines/prompt.mjs`: the execute run sees only the frozen draft; a run that reaches the web is not
  handed the office's material unasked (`runsOnWeb`).
- `engines/connectors.mjs` `stepCalls`, `heldCall`, `bookingOf`: a posting step's arguments are read as one JSON
  object; after the OK a held call must equal one of them; the `at` of a tool the office waits for books the run.
- `company/office.mjs` `approve`: steps with a time are booked for it, already frozen; an unreadable, double
  or past one approves nothing; a booking never runs early; one that has missed its time by more than an hour
  while the office was off or paused goes back to the in-tray unsent. `runsOf` tells the page and the phone
  when a waiting draft would run.
- `company/office.mjs` `exposures`: a run that could read private material and reach the web is named at
  start and refused unless accepted (`security.acceptExposure`).
- `core/clean-env.mjs`: stdio connectors start with a clean environment.
- `io/server.mjs`: 127.0.0.1 only, unless `CLICKMARKERS_TOKEN` is set; same-origin JSON writes only.
- `engines/office-tools.mjs` `openPath`: the guard for the folders opened to the office.
- `core/secrets.mjs`: secrets read from one file, handed to the one process that needs them, scrubbed
  from every error.

## 7. Connectors

A registry entry (`company/connectors.json`):

```json
{ "label": "Canva", "type": "http", "url": "https://mcp.canva.com/mcp", "auth": "oauth",
  "readOnly": ["search-designs", "read-design", "list-*"],
  "outbound": ["create-*", "edit-*", "upload-*"],
  "private": false, "web": false, "notes": "what the desks should know" }
```

- `type`: `http` or `sse` (remote) or `stdio` (a program on this machine). claude.ai's own connectors are
  not supported: they ride on a Claude subscription login.
- Secrets are referenced as `${NAME}` in `headers` or `env`. The value travels in the run's environment and
  Claude Code fills it in, so a token never sits on a command line.
- `own: true` marks the office's own servers (`servers/`): they are given the secrets file's path, never
  the values. `{root}` in an argument is this install's folder. `media: true` also gives one the media
  folders, the only place it may read pictures from.
- `verbatim`: the arguments of an outbound call that must go out as approved (a post's words, picture,
  link and time); after the OK the call must match one written in the approved steps, each runs once.
- `waits`: tools that cannot book themselves (Instagram); the office waits for the `at` their step carries.
- `private` and `web` feed the exposure check (section 6).

The office's own servers: `servers/mail.mjs` (any IMAP mailbox with an app password),
`servers/google.mjs` for Drive, Docs, Sheets and Calendar through Google's normal APIs (one sign-in with
`clickmarkers connect google`, one process per service, no delete, every write after the OK), and
`servers/meta.mjs` for the Facebook Page and its Instagram account through Meta's Graph API (the Page token
from `clickmarkers connect meta`; posts after the OK, in the approved words; no delete; see
`docs/meta.md`).

## 8. The page

The page is a skin over the API and the event stream; nothing on it has a second data path.

- Vite + React + Tailwind + Three.js, source in `ui/`, built to `web/dist/` by `npm run build`. Fonts are
  bundled; nothing loads from a CDN.
- One store (`ui/src/lib/store.js`): one `EventSource` on `/api/events`, periodic fetches, `actions` as
  the only writes. Panels read it through hooks.
- Colour and type are tokens in `ui/src/index.css`, mirrored for WebGL in `ui/src/lib/tokens.js`; a test
  keeps them in step. Status always comes with an icon and a word, never colour alone.
- The war room (`ui/src/floor/graph.js`) is plain Three.js, drawn on demand. Without WebGL it is a list of
  desks with the same states.
- Under 1280 px the page is one view at a time with a tab bar; every sheet is full screen.
- Charts follow the rules in `ui/src/lib/charts.js` (fixed day slots, untracked days hatched, never zero),
  each with a table view.
- `/?debug` puts `window.clickmarkers` on the page; `absorb(event)` plays a wire event through every panel.

## 9. Files on disk

```
company/          company.json, routines.json, workflows.json, connectors.json
<brain>/          the owner's notes; 90-Inbox (the drop folder); skills/<name>/SKILL.md for desks;
                  Clickmarkers/desks (notebooks) and Clickmarkers/lessons; the stats file
data/             tickets.json, ledger.jsonl, events.jsonl, batches.json, connectors-state.json,
                  runs/ (per-run working folders); never committed
.secrets.local    the secrets (any path; named by secretsFile); never committed
```

The stats file that feeds the Numbers view is described in `docs/stats.md`.

## 10. Another company on the same frame

Everything above is generic. A second company is a new `company.json`, `routines.json`, `workflows.json`,
a brain and a connector list. `templates/it-office` is an engineering office: an engineering manager,
backend, frontend, QA, platform, security and release leads, with GitHub (read-only as shipped) and
Figma in the registry and Vercel, Supabase and Sentry left for the owner to add; push, merge and deploy as
the outbound steps, and review and tests before anything is merged.
