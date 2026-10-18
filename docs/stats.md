# The stats file

The Numbers view and the telemetry panel read one JSON file, named in `office.config.local.json`:

```json
{ "stats": { "file": "C:/my-office/brain/00-Meta/stats.json" } }
```

Nightdesk never makes this file itself. Something you run writes it: a small script on a schedule, a
connector's job, or a desk with a routine. Desks read it too (it is put in their prompt as "the live
numbers"), so they quote real figures instead of guessing. Every field is optional. A field the file
does not have shows as "not known", never as zero.

`npm run demo` writes a full example to `.demo/brain/00-Meta/stats.json`. Copy its shape.

## Fields

```jsonc
{
  "updatedAt": "2026-10-13T07:30:00Z",   // when the numbers were read; the page says how old they are

  "marketing": {
    "postsScheduled": 7,                  // posts booked ahead
    "costPerChatUsd": 4.78,               // cost per enquiry (or per chat) across the ads
    "targetCostPerChatUsd": 6             // the target; the tile says on or off target
  },
  "sales": {
    "leadsToday": 3, "leads7d": 27,
    "waitingForOwner": 2,                 // leads waiting on you
    "stuck": 3, "stuckDays": 2            // leads quiet for stuckDays or more
  },
  "fin": {
    "spendTodayUsd": 6.4, "spend7dUsd": 71.96, "spendAllUsd": 214.9,
    "dailyBudgetUsd": 12                  // the ad budget, not the office's own API ceiling
  },

  "ads": [                                // one row per ad, for "spend by ad"
    { "id": "ad1", "name": "Reel · before and after", "spend": 71.2, "impressions": 9800, "chats": 19 }
  ],

  "funnel": { "new": 3, "contacted": 4, "quoted": 6, "booked": 9, "regular": 5, "lost": 3 },
  "stageLabels": { "regular": "Regular customer" },   // names for the stages; otherwise the key in words
  "goal": { "from": "quoted", "to": "booked" },       // the headline pair; otherwise the last two stages
  "exits": ["lost"],                                  // stages that leave the pipeline
                                                      // (default: not_eligible, lost, dropped)

  "daily": {                              // up to 14 days, oldest first, one entry per day
    "ads":   [{ "date": "2026-10-12", "spend": 10.9, "impressions": 1576, "reach": 1212, "linkClicks": 23, "chats": 2 }],
    "leads": [{ "date": "2026-10-12", "leads": 4, "clicks": 17 }]
  },

  "_inputs": {
    "leads": { "today": { "date": "2026-10-13" }, "last7d": { "clicksByTag": { "site": 22, "fb14": 17 } } },
    "adsToday": { "campaign": { "name": "Spring windows", "dailyBudgetUsd": 12, "spend": 6.4, "linkClicks": 14, "chats": 2 } },
    "adsAll":   { "campaign": { "name": "Spring windows", "spend": 214.9, "chats": 45, "linkClicks": 412, "impressions": 27800 } }
  },

  "charts": [],                           // extra charts, shown on the Numbers sheet as they come
  "errors": { "meta": "token expired" },  // sources that failed this time: the page says so
  "stale": ["meta"]                       // sources whose figures are old
}
```

## How the page reads it

- **Days before tracking began** are hatched as "not tracked yet". A day counts as tracked from the first
  day any series has a figure.
- **Under four tracked days** the page shows the figures instead of a chart.
- **Clicks by channel** group the tags in `clicksByTag` by their prefix: `fb` is Facebook posts, `reel` is
  reels, `site` is the website, and so on (`ui/src/lib/stats.js`, `channelOf`).
- **Refresh** on the page runs the one tool named in `office.config.json` as `stats.refresh`
  (`{ "connector": "...", "tool": "..." }`), if you set one. Without it the button says there is nothing
  to run.
