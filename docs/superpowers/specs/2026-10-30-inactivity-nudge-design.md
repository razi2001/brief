# The reminder: Brief's popup, for people who stopped using it

Date: 2026-10-30. Status: design approved by Razi. Replaces the in-page
"Seen a bug?" card of #108, which never shipped (1.7.4 was not uploaded).

## Goal

Most people who pair the extension make one brief, then forget it is there.
When someone has gone a week without a brief, Brief's own popup opens under
its toolbar icon, on a page they use, to remind them it is installed.

## What they see

The usual popup, plus one line on top: **Seen a bug?** Nothing else is new, and
no shortcut is named. Clicking anywhere outside closes it, as with any popup.

The worker calls `chrome.action.openPopup()` and sets a short-lived
`nudgeReminder` flag in `chrome.storage.local` first (like
`pendingExpandBriefId`). popup.js shows the line when the flag is under 15 s old,
and removes it either way, so opening the popup by hand never shows the line.
When the extension isn't pinned, Chrome anchors the popup to the puzzle-piece
menu.

## When it opens

All of these, checked by the worker on `CONTENT_READY` (top frame only), after
that page load's Replay sites sync:

- The browser is paired (`briefCloudToken` is set).
- The window is the focused one (Chrome refuses a popup anywhere else) and the
  tab is the one in front.
- Nothing was made for 7 days. The clock, `usedAt`, is the latest of:
  - a capture started here (recording, screenshot, one-click report, video
    file) or a brief filed or drafted here;
  - the pairing;
  - the server's `lastBriefAt`: the user's newest brief from any browser, or
    their pairing when they have none, sent with `/api/replay-sites` (a request
    the extension already makes on page loads).

  A browser paired before this version has no local clock, so the server's
  answer gives it one: a user quiet for 7+ days gets the reminder on the first
  page load after updating. With neither, nothing opens until the server
  answers.
- It hasn't opened in the last 7 days.
- No recording is running.
- The page is one of the org's Replay sites when there are any, otherwise any
  http(s) page. Never get-brief.app or its subdomains, never the Brief app
  (`APP_URL`), never `chrome://` and other non-web pages.

If `openPopup` rejects (an older Chrome, the window lost focus, another popup
already open), it does not count as shown: the last showing is put back and a
later page load tries again, at most 3 refused tries a day. There is no
in-page fallback and no badge.

State lives in `chrome.storage.local` under `nudge`:
`{ usedAt, shownAt, prevShownAt, tries: { day, n } }`.

## What it logs

Razi asked for this, so it is the one place the extension reports something
of its own. It is minimal and disclosed on the privacy page.

The extension sends three events, fire and forget, with the pairing token, to
`POST /api/extension-events`. That endpoint accepts only these names and keeps
only `replay`:

| Event | When | Props |
|---|---|---|
| `nudge.shown` | `openPopup` resolved | `{ replay: true \| false }`: is the page one of their Replay sites |
| `nudge.brief_it` | a capture or filing started while the reminder popup was open (Record, Screenshot, video file, Create) | none |
| `nudge.closed` | the reminder popup closed with none of those | none |

Nothing else about the page is sent: no URL, host or title. popup.js holds a
port (`nudge-reminder`) open while the reminder is up, so the worker knows
whether a capture started before it closed.

A brief started from the reminder carries `via: "nudge"` in its create request.
This covers both the popup's filing and a recording's upload, and the server
adds it to `brief.created`.

/admin/activity:

- The person timeline reads "Brief's popup reminded them (on a Replay site)",
  "Started a brief from the reminder", "Closed the reminder", and "Created a
  brief (…) from the reminder".
- The list page has a 30-day "Reminder popup" summary: Shown, Started a brief,
  Closed, No action (neither, before that person's next showing), and Briefs
  from it.
- `nudge.shown` doesn't count toward "Last seen", because the person didn't do
  it.

## Tests

- **Unit, `extension/test/nudge.test.mjs`:**
  - the 7-day rule and the page rule;
  - seeding from `lastBriefAt`: an existing user quiet 30 days gets it at once,
    and one active 2 days ago waits;
  - a brief in another browser moves the clock forward and never back;
  - with no clock yet, nothing opens and nothing is stored;
  - a refused open puts the last showing back, with 3 tries a day;
  - the logger sends only the three names, nothing about the page.
- **Unit, web:** the endpoint's allowlist (`app/api/extension-events/route.test.ts`),
  `lastBriefAt` (`lib/extauth.test.ts`), the timeline lines and the 30-day
  summary (`lib/activity.test.ts`).
- **e2e, `extension/test/e2e/nudge.suite.mjs`:** with the real popup opened by
  `chrome.action.openPopup` in Chrome for Testing:
  - it opens with the line for an existing user quiet 10 days (server-seeded),
    once a week, and only on a Replay site when there are some;
  - Create from it files with `via: "nudge"`;
  - closing it is logged and it stays quiet for a week;
  - a popup opened by hand has no line;
  - it never opens unpaired or over get-brief.app;
  - the three requests reach the mocked server in order, with no page data.
