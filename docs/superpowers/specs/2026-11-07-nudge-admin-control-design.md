# The reminder: owner control

The owner wants to show the reminder on demand, to the people they pick,
choose what it says, and see what each person did with it.
Builds on 2026-10-30-inactivity-nudge-design.md (the reminder is Brief's own
popup, opened under the toolbar icon with one line on top).

## What the owner gets

**/admin/card** ("Bug card" in the owner's sidebar):
- **Text**: the line on top of the popup, with a preview. Empty means "Seen a bug?".
- **Everyone**: "Show to everyone" (asks first), and what happened to the last one: how many saw it, closed it, briefed.
- **People**: everyone, paired browsers first. Each row has a checkbox, search, "Show to N", and a status for the last reminder sent to them (theirs or everyone's):
  - Sent: it hasn't opened yet;
  - Saw it: it opened;
  - Closed it: it closed with nothing started;
  - Briefed: a capture or filing started from it.

  People without a paired extension can't be picked.

**/admin/activity/<userId>** also has "Show the reminder".

## How a push reaches people

- The extension pulls `GET /api/nudge` (`{ message, button, push }`) at most every 5 minutes, on a page load, using its pairing token. A push opens the popup on the person's next page load after that.
- It skips the quiet week. It still opens only in the focused window, never on Brief's own site or app, never unpaired, never while recording.
- It opens once per browser (`pushSeen`). If Chrome refuses to open it, it is tried again on a later page load (`prevPushSeen` is put back), 3 tries a day at most.
- A push older than 3 days is ignored.
- The text is set with textContent, capped at 80 characters.

## What is logged

#110's three events (`nudge.shown`, `nudge.brief_it`, `nudge.closed`) carry `push`, the push's id, when the owner sent it. `/api/extension-events` keeps it only when it is a uuid. `/admin/card` joins these events to `nudge_pushes`. The privacy page's Usage log section says the popup also opens "because we asked it to".

## Pieces

- Tables `nudge_settings` (the text; its `button` column is unused since the popup has no button of its own) and `nudge_pushes` (one row per person, or `user_id` null for everyone). Migration 0017, applied 2026-11-07.
- `web/lib/nudge.ts`: pure (text, caps, `parseTargets`, `cardStatuses`). `web/lib/nudge-server.ts`: DB access.
- `PUT /api/admin/nudge` (text) and `POST /api/admin/nudge/push` (`{ userIds }` or `{}`): owner only.
- Extension 1.7.6: `claimNudge` answers `'push'`, `'weekly'` or false. `nudgeReminder` carries the text to popup.js. `cardEvent` sends the push id.

## Tests

- web: `lib/nudge.test.ts` (statuses, targets), the routes, `extension-events` (push kept only as a uuid), `NudgeAdmin` and `NudgePeople` in jsdom.
- extension unit: push once, inside the quiet week, with no clock, retried after a refusal.
- e2e `nudge`: a pushed popup with the owner's text, opened once, its events carrying the push id.
