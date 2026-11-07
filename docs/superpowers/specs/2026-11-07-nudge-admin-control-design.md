# "Seen a bug?" card: owner control

The owner wants to show the card on demand and choose what it says.
Builds on 2026-10-30-inactivity-nudge-design.md.

## What the owner gets

- **/admin/card**: the card's text and button label, a preview, Save, and
  "Show to everyone". Empty fields mean the built-in "Seen a bug?" / "Brief it".
  The text applies to every card, weekly or pushed.
- **/admin/activity/<userId>**: a "Show the card" button and when it was last
  pushed to that person.

A push reaches a browser on its next page load once the extension has checked
in (at most every 5 minutes). The extension can't be pushed to.

## Rules

- A push shows once per browser, on a page that may carry the card (not Brief's
  own site or app; a Replay site when the org has any), never unpaired, never
  while recording. It skips the 7-day quiet rule and the once-a-week rule, and
  counts as a showing for the weekly rule.
- A push older than 3 days is ignored, so a browser paired later doesn't get
  an old one.
- Text caps: 80 characters, button 24. The content script sets them with
  textContent, never HTML.
- "Brief it" keeps doing what it does today; only its label changes.

## Pieces

- `web/supabase/migrations/0017_nudge.sql`: `nudge_settings` (one row: message,
  button) and `nudge_pushes` (user_id, null = everyone). Service role only.
- `web/lib/nudge.ts` (pure: defaults, caps, the answer) and
  `web/lib/nudge-server.ts` (DB). Reads fail soft to the defaults and no push,
  so the extension works before the migration is applied.
- `GET /api/nudge` (extension, pairing token): `{ message, button, push }`.
- `PUT /api/admin/nudge` (text) and `POST /api/admin/nudge/push`
  (`{ userId? }`): owner only, 403 for everyone else.
- Extension: `syncNudge` in nudge.js stores the answer; `claimNudge` takes the
  push; NUDGE_SHOW carries the text. Version 1.7.5.

Nothing is logged about the user. The GET is a config pull like
/api/replay-sites, sent with the pairing token the extension already holds.

## Tests

Unit: web/lib/nudge.test.ts, the routes (auth, caps, push scope), extension
nudge.test.mjs (push once, stale push, still blocked on Brief's site and while
recording). e2e: nudge.suite.mjs gets a pushed card with custom text against
the mock server.
