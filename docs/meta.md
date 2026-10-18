# Meta: your ads, your Facebook Page and Instagram

Two connectors reach Meta. They use one sign-in.

| Connector | What the desks can do | Secret |
|---|---|---|
| `meta-ads-remote` (Meta's own Ads MCP) | Read your ads and their results. After your OK: pause, start, change budgets, make ads. | `META_MCP_TOKEN` |
| `meta-pages` (the office's own) | Read the Page's posts, what is booked and the Instagram posts. After your OK: post on the Page and on Instagram. | `META_PAGE_TOKEN` |

The Ads MCP cannot post to a Page, so posting has its own connector.

## Set it up once

1. **Make a Meta app.** On [developers.facebook.com](https://developers.facebook.com), create an app of
   the Business type. It can stay in development mode: you are its admin, and nobody else signs in to it.
2. **Add Facebook Login for Business** to the app. Under its settings, add this to the valid OAuth
   redirect URIs: `http://localhost:4621/meta/callback`.
3. **Put the app's ID and secret in your secrets file** (`../my-office/.secrets.local`):
   `META_APP_ID=...` and `META_APP_SECRET=...` (the app's Settings, Basic).
4. **Link Instagram, if you want it.** The Instagram account must be a professional account (business or
   creator) linked to the Facebook Page, in Meta Business Suite under Settings, Linked accounts.
5. **Sign in.** `node bin/clickmarkers.mjs connect meta`. The browser opens; press Continue. The office
   writes `META_MCP_TOKEN` and, for the Page, `META_PAGE_TOKEN` into the secrets file. If you manage
   several Pages, name the one to post on: `connect meta --page "Larkspur Cleaning"`. `--ads-only` asks
   for the ads permissions alone.
6. **Check.** `npm run check` lists both connectors. Ask the marketing desk: "MARKETING: which Page and
   Instagram account can you post on?" It answers with `social_accounts`.

The Page token made this way does not expire. If you change your Facebook password or remove the app,
sign in again.

## How a post goes out

A desk writes the post and shows it to you in the in-tray, with the steps under **AFTER YOUR OK**. Each
posting step starts its own line and carries its arguments as one JSON object, the words in full:

```
AFTER YOUR OK
1. page_post({"message": "Clear windows by Friday. Outside from £20 on a 3-bed semi.", "image": "media/spring.png", "at": "2026-10-22T18:00"})
2. ig_post({"caption": "Clear windows by Friday. Outside from £20 on a 3-bed semi.", "image": "media/spring.png", "at": "2026-10-22T18:00"})
```

- **Facebook** books the post with Meta (`at`, up to 30 days ahead), so it goes out on time even if your
  computer is off. A time less than half an hour away is waited for by the office instead, and a post is
  never published before its time.
- **Instagram** cannot be booked through Meta's API. With an `at`, the office waits after your OK and runs
  the steps at that time, so the office must be running then. If it was off or paused and the time has
  passed by more than an hour, nothing goes out: the draft comes back to your in-tray, to send back with
  a new time.
- **You see when it runs.** Before you approve, the page and the phone say "Runs Thu 22 Oct 18:00",
  "Runs on your OK; Facebook publishes the post Thu 22 Oct 18:00" or "Goes out as soon as you approve". A
  time the office cannot read, two different times, a post with a time beside one without, one that has
  passed, or one too far ahead approves nothing.
- **Exactly as approved.** After your OK a post runs only as one of the steps you approved, once each:
  the same words, picture, link and time. Line breaks and spacing in the words may change; a word, a
  price, a picture or a time may not. A picture is held by its content: if the file is changed after
  your OK, the post is refused.
- **Pictures** come from the office's media folders (`media.roots` in `office.config.local.json`), as JPEG
  or PNG up to 8 MB, or from a public https link the draft names. Instagram fetches pictures from the web
  and takes JPEG only, so the office uploads yours to the Page unpublished first; it never shows on the
  Page.

## Limits

- Instagram: picture posts only for now (no reels, carousels or stories), up to 2,200 characters and 30
  hashtags, and up to 100 posts a day through the API.
- Nothing can be deleted through the office. Delete a post on Facebook or Instagram yourself.
