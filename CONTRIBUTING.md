# Contributing to Nightdesk

Thank you for looking. Bug reports, ideas, docs and code are all welcome.

## Before you start

- **Small fix** (a typo, a bug with an obvious cause): open a pull request straight away.
- **Bigger change** (a new engine, a new view, a change to how approvals work): open an issue first and
  say what you want to do. It saves you building something that cannot be merged.
- **Security problem**: do not open an issue. See [SECURITY.md](SECURITY.md).

## Set up

You need Node 22 or newer. Nothing else is needed to work on the code: the tests and the demo never
reach a model.

```bash
git clone https://github.com/AlexCJK1/nightdesk.git
cd nightdesk
npm install
npm run build        # the page, into web/dist
npm run demo         # http://127.0.0.1:4600, a made-up business, nothing runs
npm test             # about 180 tests, no network, under a minute
```

`npm run ui:dev` serves a live-reloading copy of the page on port 4601 against an office on 4600.

## How the code is written

These rules keep a growing codebase readable. Pull requests that follow them are merged faster.

- **Plain Node.** ESM, Node 22+, no framework on the server, no native modules. The same code runs on
  Windows, macOS, Linux and a VPS.
- **A test for every behaviour change.** `test/` uses `node:test`. No test may reach a model or the
  network: `NIGHTDESK_NO_MODELS=1` and `NIGHTDESK_NO_LOCAL=1` are set by every test file.
- **The safety model does not get weaker.** Nothing a desk does may send, post, schedule, spend or change
  a live system without the owner's OK. If your change touches `engines/agent.mjs` (`toolGate`),
  `engines/connectors.mjs` (`outboundTool`), `engines/prompt.mjs` or `core/guard.mjs`, explain in the pull
  request why it is still safe, and add a test to `test/security.test.mjs`.
- **Secrets never enter the repo, a log or a prompt.** They live in the secrets file and reach only the
  process that needs it.
- **Prompt caching.** `systemPrompt()` must stay byte-identical from run to run for a desk. Anything that
  changes per run goes in `userPrompt()`.
- **Writing.** British English, short sentences, no em dashes. Comments say why, not what.
- **The page** (`ui/src`) uses the colour and type tokens in `ui/src/index.css` (mirrored for the 3D floor
  in `ui/src/lib/tokens.js`; a test keeps them in step) and the patterns already there: every view works
  with the keyboard, at phone width and with a screen reader.

`ARCHITECTURE.md` explains how the parts fit together. Read it before changing the frame (companies,
tickets, engines, lanes, the ledger).

## Pull requests

- One change per pull request, with a title that says what and why.
- `npm test` passes and `npm run build` succeeds.
- Screenshots for anything you can see.
- No business data: the example company in `company/` and `examples/brain/` is made up. Keep it that way.

## The contributor licence agreement

Before your first pull request can be merged, you sign the [CLA](CLA.md) by posting one comment (the bot
tells you the words). You keep the copyright in your work. The CLA lets the maintainer also offer
Nightdesk under a commercial licence, which is how the project can pay for itself, and it promises that
anything containing your work stays available as open source.

## Good first issues

Issues labelled `good first issue` are small and well described. Some ideas that are always welcome:

- A company template for another kind of business (see `templates/`).
- A connector entry for a service you use, with its read-only list (see `company/connectors.json`).
- Translations of the page.
- Better docs: a clearer step, a missing screenshot, a how-to for something you worked out.

## Code of conduct

Be kind and assume good faith. Harassment of any kind is not tolerated. See
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
