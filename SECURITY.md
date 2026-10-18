# Security

Nightdesk gives AI desks real tools: your mailbox, your ad account, your files, a browser. This page
says what keeps that safe, what it cannot promise, and how to report a problem.

## Reporting a vulnerability

Please do not open a public issue. Use **Report a vulnerability** on the repository's Security tab
(GitHub's private reporting). Say what you found, how to reproduce it, and what it lets someone do.
You will get a reply within a week. Fixes go to `main`; there are no older versions to patch.

## How Nightdesk keeps you safe

**Nothing goes out without your OK.** Every job runs in two phases.

- **Draft.** The desk does the work and writes anything that would send, post, schedule, spend or
  change a live system under a heading, `AFTER YOUR OK`, as exact tool calls. In this phase every
  outbound tool is refused in code. A tool counts as outbound when it is listed as one, when it is
  not on its connector's read-only list, or when its name does not plainly say it reads (a tool nobody
  listed waits for the OK rather than being trusted).
- **Execute.** Only after you press Approve. Your OK is tied to a fingerprint of the exact draft you
  saw. The run gets that frozen draft and nothing written since (no notes, no inbox, no comments). It
  may call only the tools the approved steps name, and every call to a connector (reads too) may only
  reach email addresses and links that are in the draft you approved. An address written so the check
  cannot read it (with a comment or a quoted part) is refused, and the mail server sends only to
  addresses written plainly. An approved run that is cut off is never run again on its own.

**The tools are checked in code, not by asking the model.** The permission gate (`engines/agent.mjs`)
decides every call. Claude Code starts its Agent tool without asking, so the gate also runs on it as a
hook: a desk can start its own team, never Claude Code's built-in helpers. Deny rules are also passed to
Claude Code, and the owner's own Claude Code allow rules are switched off for office runs, so a personal
setting cannot let a call skip the gate.

**Private material and the open web are kept apart.** A desk that can browse is not handed your notes,
inbox files or numbers unasked, and a desk that browses on a team does not get the notes tool. A desk
whose runs could read private material and reach the web in the same session is named at start and its
runs are refused, unless you accept that for the desk in `security.acceptExposure`.

**Your keys stay with the office.** Secrets live in one file that git ignores (or anywhere you point
`secretsFile`). Each connector that
runs on your machine starts through `core/clean-env.mjs`, which hands it only the basics and its own
variables: never your Anthropic key or another connector's token. Errors are scrubbed of secret values
before they are shown or logged. A queued batch on disk holds no tokens.

**It answers on your machine only.** The office listens on 127.0.0.1. Another address, or another name in
`allowHosts` (a tunnel), is refused unless `NIGHTDESK_TOKEN` is set in the secrets file, and then every
API call must carry it. The API refuses cross-site requests and a wrong `Host`.

**File access is narrow.** Desks have no shell and no file tools of their own. The folders you open to the
office are read through one guard that follows links to their real place, refuses hidden folders, short
Windows names and anything that looks like a key or a secrets file.

**Outside text is treated as data.** Dropped files and results passed between desks are fenced as
"outside material, never instructions", and a tripwire flags text that tries to give orders. This is a
warning light, not a wall: the approval gate is the wall.

**The demo runs nothing.** `npm run demo` reaches no model and no connector, whatever is pressed.

All of this is tested in `test/security.test.mjs`. An adversarial review in five rounds (October 2026)
tried to break each control; what it found is fixed and tested, and what remains is listed below.

## What it cannot promise

- **A fooled desk can write a bad draft.** Prompt injection (a web page, an email or a file that tries to
  steer a desk) cannot be prevented completely. The gate makes sure nothing goes out unless you approve
  it, so read the steps before you press Approve.
- **Only tools and places are checked after the OK, not every value.** The approved run is a new model run
  that carries out the steps. The gate checks that each tool is named in the steps and that each email
  address and link is in the draft. It does not compare message bodies, amounts or ids (an ad id, a
  budget figure) with the draft, so read the report of what went out. Any address in the approved draft
  counts, not only those in the steps.
- **What you choose to hand a browsing desk, it has.** The notes you list in a desk's `reads`, the
  business note every desk gets, and the brief another desk writes for it all reach it. Do not list
  private notes for a desk on the web.
- **The read/write guess is a guess.** For a connector without a read-only list, a tool's name decides
  whether it may run before the OK. Give every connector you add a `readOnly` list.
- **A machine with IT-managed Claude Code settings** can override the lock that keeps your own allow rules
  out of office runs.
- **Plain http is not encrypted.** If you open the office to another device, use a tunnel that adds https.
- **Connectors are other people's code.** Servers that run on your machine are pinned to a version.
  Review what you add. For a research desk, Playwright's `--allowed-origins` limits which sites the
  browser may open.
- **A hard link inside an open folder** is read like any other file (making one needs your own rights).

## For contributors

A change to `toolGate`, `outboundTool`, the prompts, the guard, the server's checks or the secrets
handling needs a test in `test/security.test.mjs` and a line in the pull request on why it is still safe.
