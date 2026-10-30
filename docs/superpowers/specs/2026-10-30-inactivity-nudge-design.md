# "Seen a bug?": a card for people who stopped using Brief

Date: 2026-10-30. Status: design approved by Razi.

## Goal

Most people who pair the extension make one brief, then forget it is there.
When a paired browser has gone a week without a brief, a small card on a page
they use reminds them that Brief is one click away.

## The card

Bottom right of the page, in the recording bar's look (dark glass, orange
button): **Seen a bug?**, a **Brief it** button and a ×. No other text, and no
keyboard shortcut in it.

- **Brief it** runs the same one-click report as the right-click "Brief it"
  (`startAutoReport`) on a Replay site. On any other page there is no last
  minute to send, so it starts a screenshot instead (the annotator, as the
  popup's Screenshot does). The card goes away either way.
- **×** closes it. The one-week wait starts.

It sits in a closed shadow root added by the content script, so the page's CSS
can't reach it and the page can't read it.

## When it shows

All of these, checked by the worker on `CONTENT_READY` (top frame only):

- The browser is paired (`briefCloudToken` is set).
- Nothing was made here for 7 days. "Made" is any capture started (recording,
  screenshot, one-click report, video file) or a brief filed or drafted.
  Pairing starts the clock, so someone who never made one sees it 7 days after
  pairing. A browser that was already paired before this version starts the
  clock on its first page load with it.
- The card hasn't shown in the last 7 days (shown once counts, acted on or not).
- No recording is running.
- The tab is the one in front.
- The page: one of the org's Replay sites when there are any; otherwise any
  http(s) page. Never get-brief.app or its subdomains, never the Brief app
  (`APP_URL`), never `chrome://` and other non-web pages.

State lives in `chrome.storage.local` under `nudge`: `{ usedAt, shownAt }`.

## What the server learns

Nothing new is sent. A brief started from the card carries `via: "nudge"` in
the create request the extension already makes (`POST /api/briefs`), and the
server adds `via: "nudge"` to that request's `brief.created` event, so
/admin/activity shows which briefs the card brought back.

## Tests

- Unit (`extension/test/nudge.test.mjs`): the timing rule and the page rule.
- e2e (`extension/test/e2e/nudge.suite.mjs`): with 8 days faked, the card shows
  on a Replay site; Brief it files a one-click report with `via: "nudge"`; ×
  hides it and it stays hidden on reload; it shows again once the week has
  passed; it never shows on get-brief.app, on a page that isn't a Replay site
  when there are some, or for an unpaired browser; with no Replay sites it shows
  on any page and Brief it opens the screenshot annotator.
- Web unit tests for the `via` marker and its activity line.
