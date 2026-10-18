<h1 align="center">Clickmarkers</h1>

<p align="center"><b>The marketing department you own.</b><br>AI staff who post to Facebook and Instagram, run your ads and answer enquiries.<br>On your computer, on your say-so.</p>

<p align="center">Clickmarkers by Alex Cojoaca</p>

<p align="center">
  <a href="LICENSE"><img alt="Licence: AGPL-3.0" src="https://img.shields.io/badge/licence-AGPL--3.0-0b7285"></a>
  <img alt="Node 22 or newer" src="https://img.shields.io/badge/node-%E2%89%A522-0b7285">
  <a href="https://github.com/AlexCJK1/clickmarkers/actions/workflows/test.yml"><img alt="Tests" src="https://github.com/AlexCJK1/clickmarkers/actions/workflows/test.yml/badge.svg"></a>
  <img alt="Powered by Claude" src="https://img.shields.io/badge/powered%20by-Claude-6741d9">
</p>

<p align="center"><img src="docs/img/war-room.gif" alt="The Clickmarkers demo office at work: the chief of staff splits a job, the marketing lead, content, design and rulings desks light up as working, the ads desk reads the numbers, and a draft ends up waiting for the owner's OK" width="100%"></p>

Clickmarkers runs a small company of AI desks for your business: a chief of staff, six department leads
and the specialists under them, for posts, design, ads, the inbox, leads, the numbers and the weekly
report. You give it jobs in plain words, on the page or from your phone. The desks do the work with
your real tools (your ad account, your mailbox, Canva, Google Drive, a browser) and anything that would
send, post, book or spend comes to your **in-tray** as a draft. One tap approves it.

It is for small businesses that cannot afford an agency: a window cleaner, a café, a lettings agent, a
hair salon. Setting it up takes someone happy in a terminal, the owner or whoever looks after their
computers: you install Node, edit a few JSON files and create developer access for Google and Meta. Using
it day to day is a web page and a phone.

**Status:** early (0.2). Expect rough edges, and please report them.

## Try the demo

You need [Node 22 or newer](https://nodejs.org). The demo needs no API key and sends nothing. `npm install`
downloads about 1.2 GB: the Claude Agent SDK, and an optional package that turns voice notes from your phone
into text on your own machine. `npm install --omit=optional` leaves that out and saves about 450 MB. Give it
a few minutes.

```bash
git clone https://github.com/AlexCJK1/clickmarkers.git
cd clickmarkers
npm install
npm run build
npm run demo:show
```

Open <http://127.0.0.1:4600>. You get Larkspur Cleaning Co., a made-up window cleaner in Bristol: 30
desks, two drafts waiting for your OK, a fortnight of numbers, and a scripted day replayed on the floor.
That company is deliberately big, to show what the frame can hold. Your own office starts from five desks.
Press `?` for the keys, `I` for the in-tray, `N` for the numbers.

## What it does

<table>
<tr><td width="50%"><img src="docs/img/main.webp" alt="The main screen: the executive suite, the war room and telemetry"></td><td>

**A war room you can watch.** Every desk is a pod on a live floor. Work moving between desks lights the
lines, and each desk shows what it is doing in words, not only colours. The executive suite, the live
logs and your numbers sit around it.

</td></tr>
<tr><td><img src="docs/img/intray.webp" alt="The in-tray with a draft, its evaluations verdict and the Approve and Reject buttons"></td><td>

**An in-tray, not an autopilot.** Drafts arrive already checked: a separate evaluations desk reads each
one against your facts, your house rules and your past corrections before you see it. **Approve** carries
out the steps you read, with only the tools they name. **Reject** with a note sends it back, and the desk
keeps the lesson.

</td></tr>
<tr><td><img src="docs/img/desk.webp" alt="A desk opened: its team on the floor and its work, budget, tools and brief"></td><td>

**Desks you manage like staff.** Give each one a standing brief, a model, a daily budget and the tools
it may use. Pause it, chat with it, see what it has in hand and what it finished. Leads split big jobs
and hand pieces to their team.

</td></tr>
<tr><td><img src="docs/img/numbers.webp" alt="Numbers: leads per day, clicks by channel, the pipeline and the paid ads"></td><td>

**Your numbers in one place.** Ad spend, cost per enquiry, leads, the pipeline, clicks by channel, all
from one stats file. Desks quote those figures instead of guessing, and every chart can show itself as a
table. Clickmarkers does not fetch the numbers itself yet: a script or a desk of yours writes the file
([docs/stats.md](docs/stats.md)).

</td></tr>
<tr><td><img src="docs/img/routines.webp" alt="Routines: a new routine typed in plain words, the list of routines and the workflows"></td><td>

**Routines in plain English.** "Every weekday at 8am send me the inbox digest." The calendar shows what
runs when, and workflows chain desks together: `new-post: spring windows` has one desk write, one check
the rules, one design, and the lead put it together for your OK.

</td></tr>
<tr><td><img src="docs/img/ledger.webp" alt="The ledger: spend today against the daily ceiling, by desk and by model"></td><td>

**Costs you can see.** Every run is a line in the ledger, by desk and by model. A daily ceiling stops new
runs when it is reached; jobs wait until midnight. Prompt caching and the Batch API keep runs cheap.

</td></tr>
</table>

Also: **your phone** (a Telegram bot: jobs, voice notes, drafts with Approve buttons, results with
pictures), **a brain** (a folder of your own markdown notes the desks read, drawn as a map that lights up
when a desk reads a note), and **a page that works at phone width**.

## Safe by design

An AI with your mailbox and your ad account must not be able to act on its own. Clickmarkers makes sure of
that in code, not by asking the model nicely:

- **Nothing goes out without your OK.** Before you approve, every tool that sends, posts, books, spends
  or changes something is refused, call by call. A tool counts as one that writes unless its connector lists
  it as read-only or its name plainly says it reads (get, list, search). Two things do happen before the
  OK, by design: a reply can be saved in your mailbox's Drafts folder, and a desk with the browser can open
  a web page.
- **After you approve, only what you approved.** The run gets the exact draft you saw. It may call only
  the tools its steps name, and only with the email addresses and links in that draft. A post goes out
  exactly as its step is written, once: the words, the picture, the time.
- **Your data stays home.** It runs on your machine and listens only there. What a desk works on goes
  to the model it runs on, to the tools you connect and, if you set up the phone, to your Telegram chat.
  Nowhere else. Your keys never reach the connectors it starts. A desk that browses the web is not handed
  your private notes.
- **Tested against attack, and open about how.** A separate AI reviewer (a Claude agent told to assume the
  code is broken) spent five rounds trying to break each control. What it found is fixed and covered by
  tests in [`test/security.test.mjs`](test/security.test.mjs). That is not a human security audit; reports
  from people are very welcome.

What it cannot promise, and how to report a problem: [SECURITY.md](SECURITY.md).

## What it costs

Clickmarkers is free. The AI is billed to your own [Anthropic API key](https://platform.claude.com), pay
as you go. A daily ceiling stops new runs when it is reached: the default is $10 a day, so the most it can
spend is about $300 a month. Set it in `office.config.local.json` (`ledger.ceilingUsd`); to see pounds beside
the dollars, set `fx.gbpPerUsd`.

What it really costs, measured: the author's own office, 38 desks and 12 daily routines, averaged $1.66 a
day over its first eight days (from $0.78 to $3.69), about $50 a month. One job on its own: a four-desk
chain that wrote, checked and designed a social post took two minutes and cost $1.00.

Connectors use your own accounts: Google Drive, Docs, Sheets and Calendar, any IMAP mailbox, your Facebook
Page and Instagram, Meta Ads, Canva, Figma, a browser, and any MCP server you add.

## What works today, and what does not yet

It is version 0.2. What a desk can do is what its connectors can do:

- **Works:** drafting posts, captions, replies, ad reviews and reports; the in-tray, the evaluations desk
  and the approval gate; reading the mailbox and sending a reply after your OK; Google Drive, Docs, Sheets
  and Calendar; posting on your Facebook Page and Instagram after your OK, now or at a set time
  ([docs/meta.md](docs/meta.md)); reading Meta ads and changing them after your OK (Meta's own Ads MCP);
  Canva and Figma; a browser; routines, the ledger, the phone.
- **Not yet:** Clickmarkers does not fetch your numbers itself; the Numbers panel shows what a script or a
  desk of yours writes into the stats file. There is no CRM connector, so the Leads desks work from your
  mailbox and your notes. Instagram takes picture posts only for now: no reels, carousels or stories.
  Nothing posts to TikTok, LinkedIn or X yet; Buffer's MCP server is in the registry, switched off, because
  it has not been tested with Clickmarkers yet. macOS has not been tried.

## Set it up for your business

> **Before you start.** Plan on about an hour for a first real office, and you will be in a terminal and
> a text editor. A working office needs your own accounts: an Anthropic API key (required), and for each
> tool you want, its own access: a Google Cloud OAuth client for Drive, Docs, Sheets and Calendar, a Meta
> app for the ads and the Page, an app password for the mailbox, a Telegram bot for the phone. Every tool is optional:
> the office runs with the API key and a folder of notes.

You need Node 22+, an Anthropic API key, and a computer that stays on while the office works. Remote tools
that sign in through a browser (Canva, Figma) also need the
[Claude Code CLI](https://code.claude.com/docs/en/overview). It is used every day on Windows 11 and tested
on Linux (the tests and the build run there on every change). macOS should work but has not been tried
yet: reports are welcome.

1. **Install.** `npm install`, then `npm run build`. On Windows, `scripts\install.ps1` does steps 1 and 2.
2. **Make your own office.** `node bin/clickmarkers.mjs init` makes a folder next to this one,
   `../my-office`, with a copy of the example notes, the company files, an empty secrets file and a data
   folder, and writes `office.config.local.json` pointing at them. Everything that is yours lives there,
   so an update (`git pull`) never touches it and none of it can end up in a pull request.
3. **Add your key.** Put `ANTHROPIC_API_KEY=...` in `../my-office/.secrets.local`.
4. **Describe your business.** Edit `brain/10-Business/business.md` and the facts, prices and voice notes
   in your office folder. Desks read them on every job.
5. **Shape the company.** `company/company.json` in your office folder holds the desks: names, roles,
   briefs, models, budgets, tools, and `style`, the language desks write in. It starts with five: a chief
   of staff, an evaluations desk that checks every draft, marketing, ads and the inbox. Change them to
   yours and add desks as you need them; `templates/agency` is the full 30-desk company from the demo and
   `templates/it-office` an engineering one. If you use Claude Code, the repo's `office-ops` skill knows
   how to add desks, routines and connectors.
6. **Connect your tools.** `node bin/clickmarkers.mjs connect google` (Drive, Docs, Sheets, Calendar),
   `connect meta` (Meta Ads, and the Facebook Page and Instagram account to post on: [docs/meta.md](docs/meta.md)),
   or an IMAP mailbox with an app password.
   `connect mcp canva-remote` is for a remote MCP server that signs in through a browser: it adds the server
   to your user-level Claude Code settings (`claude mcp add -s user`), you sign in once with `/mcp` in
   Claude Code, and `claude mcp remove canva-remote -s user` takes it out again. `npm run check` says what
   must be fixed (FAIL) and what is still optional (todo).
7. **Optional: your phone.** Make a Telegram bot with @BotFather and put `OFFICE_TELEGRAM_TOKEN` and
   `OFFICE_TELEGRAM_CHAT` in the secrets file.
8. **Start.** `npm start`, then open <http://127.0.0.1:4600>. A new office starts **paused**, so the
   example routines do not run on your key before the company is yours. When it is ready, click
   **Office paused** at the top left to open it; from then on the routines in `routines.json` run on their
   schedule (pause the ones you do not need under **Routines**). A slot that passes while the office is
   paused is skipped, not saved up. To keep other programs on this computer from using the office's API, put a long random
   `CLICKMARKERS_TOKEN` in the secrets file and open the page once with `?token=` and that value.
9. **Optional: start with Windows.** `scripts\install-autostart.ps1` registers two scheduled tasks for your
   user: one starts the office at logon, one restarts it if it stops. Read the four files it uses first
   (the script says which); `scripts\uninstall-autostart.ps1` removes both.

The full walkthrough of the page, with pictures: **[the guide as a PDF](docs/Clickmarkers-guide.pdf)**, or
open `docs/guide/index.html` in your browser for the clickable version.

## How it works

```
 you ──page / phone / CLI──▶ tickets ──▶ heartbeat ──▶ a desk (a Claude session with its brief,
                               ▲                        your notes, its tools and a budget)
           routines (clock) ───┘                                    │
                                                  draft ──▶ evaluations ──▶ your in-tray
                                                                    │
                                                         Approve ──▶ the approved steps, nothing else
```

Each desk is a session on the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)
with its tools served over [MCP](https://modelcontextprotocol.io). Four engines decide where a run goes:
the agent engine for anything with tools, direct API calls for small jobs, the Batch API at half price for
anything that can wait, and the other-models engine for desks that only write (see below). More in
[ARCHITECTURE.md](ARCHITECTURE.md).

**How it was built.** With Claude Code, which wrote most of the code, directed and checked by the author.
A separate reviewer agent checked each change before it went in, and every change to behaviour comes with
a test (about 200 of them, run on every pull request).

## Questions

**Does it work with other models, or a local one?** Partly, today. A desk that only writes (captions,
translations, sorting, summaries) can run on any OpenAI-compatible service: OpenRouter, OpenAI, Gemini, or
a model on your own machine through Ollama or LM Studio. Set the desk's `engine` to `"openrouter"` and its
`model` to the model's name, and point the engine at the service in `office.config.local.json`:

```json
{ "openrouter": { "baseUrl": "http://127.0.0.1:11434/v1", "model": "llama3.1" } }
```

For a paid service add `"keyName"` (the secret that holds its key) and, if you want it counted in the ledger,
`"price": { "inPerM": 0.15, "outPerM": 0.6 }` in US dollars per million tokens. Desks that use tools, and
everything that runs after your OK, stay on Claude for now: the approval gate is built on Claude Code.
A desk you put on another model stays there: if that service fails, the job fails and says why; it is never
re-run on Claude behind your back. Its drafts are still checked by the evaluations desk on Claude unless you
set `evaluate: false` on it. Tool-using desks on other models are on the roadmap.

**Do I need a Claude subscription?** No. It runs on an Anthropic API key, billed as you go. Anthropic does not
allow products built on its Agent SDK to run on a claude.ai subscription.

**Why the AGPL?** So nobody can take Clickmarkers, host it for others and keep their changes closed. Any business
can use it free and change it for its own use.

**Why a contributor licence agreement?** It lets the project offer a commercial licence to companies the AGPL
does not suit, which pays for its upkeep. What you contribute stays in this repository under the AGPL.

**Where does my data go?** What a desk works on goes to the model it runs on, to the tools you connect and,
if you set up the phone, to your Telegram chat. Nowhere else. The office listens on your own machine only.


## Roadmap

- A first-run interview that writes your company and your brain for you.
- More company templates: a café, a trades business, a lettings agent, a hair salon.
- Tool-using desks on other models, with the same approval gate.
- More connectors with read-only lists: Shopify, Google Business Profile, Xero.
- Instagram reels and carousels; posting to TikTok and LinkedIn.
- A weekly batch review of every desk's drafts against your rules.
- Installers for macOS and Linux to match the Windows one.
- The page in more languages.

Ideas and votes are welcome in [Issues](https://github.com/AlexCJK1/clickmarkers/issues).

## Contributing

Bug reports, ideas, docs and code are all welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Issues
labelled `good first issue` are a good start. Contributors of code sign a short [CLA](CLA.md) once, on
their first pull request.

If Clickmarkers is useful to you, a star helps other small businesses find it.

## Licence

Clickmarkers is free software under the [GNU AGPL 3.0](LICENSE), with additional terms in
[NOTICE](NOTICE): keep the line "Clickmarkers by Alex Cojoaca" in the About section and the legal notices
of any copy, and give a changed version that you share or host a name of its own
([TRADEMARKS.md](TRADEMARKS.md)).
You may use it in your business for free. If you change it and offer it to others, including as a hosted
service, the AGPL asks you to publish your changes.

A **commercial licence** is available if the AGPL does not suit you: write to
<cojoaca.alex@gmail.com> with "Commercial licence" in the subject.

Clickmarkers is an independent project. It is not made or endorsed by Anthropic. "Claude" is a trademark of
Anthropic.
