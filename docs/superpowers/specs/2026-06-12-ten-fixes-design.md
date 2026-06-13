# Ten fixes: tickets UX, agentic filing, recording pipeline

Date: 2026-06-12. Scope: the 10 issues reported on 2026-06-12, spanning the web app
(tickets/dashboard display, agent pipeline) and the extension (recording, auth, tabs).

## 1. Regression: brief name shown instead of the real ticket title

**Root cause.** The agent's `fileIssue` result returns the ticket title, but only
`ticket_url` + `ticket_identifier` are persisted (`run-processing.ts`). Display depends
entirely on a live per-pageload sync (`attachTicketInfo`), which silently falls back to
the brief name whenever it fails or is clipped: Linear queries are sliced to 20
identifiers, Jira to 25, and the sync is capped at 60 rows.

**Design.**
- Migration `0004_ticket_snapshot.sql`: add `ticket_title text`, `ticket_state_name text`,
  `ticket_state_color text` to `briefs`.
- Persist `ticket_title` (and initial state when known) at filing time in
  `run-processing.ts`. Wrap in a defensive fallback so a not-yet-migrated DB still files
  tickets (retry the update without the new columns).
- `attachTicketInfo` becomes a write-back cache: after a successful live fetch, persist
  changed title/state back to the row (fire-and-forget).
- Render fallback chain: `ticket.title || ticket_title || title` (and same idea for state).
- Fix the clipping: chunk identifier batches (20/query for Linear, 25 for Jira) instead of
  slicing them off.

## 2. No way to select all tickets

Select-all exists but is invisible until at least one row is hand-selected (it's the
count button in the toolbar). Add an always-available select-all checkbox in the feed
toolbar (next to the filter) whenever rows are visible; keep the existing toolbar.

## 3. Status always shows "Filed"

Same root cause as #1: live state is fetched but never persisted, and falls back to
"Filed". With the #1 write-back cache, the last-known tracker state (name + color)
survives reloads and token hiccups. Live sync still refreshes it every page load.

## 4. Reload icon on tickets page

New `RefreshButton` client component (small icon button, spins while pending,
`router.refresh()`), placed in the tickets feed toolbar; also on the dashboard header.

## 5. Ticket preferences don't reach the tracker (agentic, generic redesign)

**Root causes.** (a) Linear *projects* aren't exposed at all (the agent can only pick
teams), so "assign the best project" can't work. (b) Jira: no state support, and
`listTargets` returns no labels/states/members metadata, so the agent guesses blind.
(c) One-shot `create_issue` with no verify/fix loop, exact-name-only state matching, and
no path for custom fields.

**Design: an MCP-shaped tracker toolset + verify loop.** The official remote Linear/Jira
MCP servers need MCP-audience OAuth tokens that Clerk doesn't vend, so we mirror MCP
semantics with an in-process toolset the agent drives. The `Tracker` interface gains:

- `listTargets()` — lightweight (id/key/name only).
- `getTargetDetails(targetId)` — states, labels, members, **projects** (Linear),
  issue types + **custom fields from createmeta** (Jira). Fetched lazily by the agent.
- `createIssue(input)` — as today plus `project`, and `extraFields` passthrough
  (Jira: arbitrary REST fields incl. custom; Linear: passthrough into the GraphQL input).
- `updateIssue(identifier, patch)` — state (Jira via transitions), assignee, labels,
  priority, project, extraFields.
- `getIssue(identifier)` — current field state for verification.

Agent loop changes (`process-brief.ts`): tools = `list_targets`, `get_target_details`,
`create_issue`, `update_issue`, `get_issue`. Max turns raised (8 → 14). Tool errors are
informative (invalid state → return the valid state list) so the agent self-corrects.
System prompt: after creating, verify the issue satisfies every preference (status,
assignee, project, labels, custom fields…) via `get_issue`; repair gaps with
`update_issue`; only then stop. Name matching is fuzzy (case-insensitive, substring).

## 6. Stop-recording blocks on the upload

**Root cause.** The whole chain (base64 the video → relay to bar → decode → sequential
uploads) is awaited before the bar shows "saved", and the bar iframe must stay open for
the upload to survive.

**Design: upload from the offscreen document, in the background.**
- When connected to the cloud, the bar's STOP handler returns immediately: the offscreen
  doc keeps the blob, the bar flips to "saved", writes the inbox entry with
  `uploading: true`, and closes.
- Offscreen assembles `brief.json` itself (it gets transcript via the STOP message, page
  meta via `GET_BRIEF_META`, the inbox entry via `chrome.storage`) and uploads
  draft files directly (it's an extension origin page; same fetch path as the bar).
  No more giant base64 relay for the cloud path.
- Background keeps the offscreen document alive until an `UPLOAD_DONE` message
  (BRIEF_STOP no longer closes it while an upload is pending).
- On success: set `cloudBriefId`, clear `uploading`, `INBOX_CHANGED`. On failure: fall
  back to the local zip download (offscreen builds the zip, background downloads it) and
  mark the entry `uploadFailed` so the popup explains.
- Popup: a brief with `uploading: true` shows "uploading…" and defers "Create ticket"
  until the id lands (storage `onChanged` already re-renders).
- Not-connected path unchanged (legacy relay → zip in the bar).

## 7. First ~2 seconds of voice are bad

**Root causes.** The mixing `AudioContext`s are never `resume()`d (autoplay policy can
leave them suspended, recording silence until they spin up); SpeechRecognition starts
only after the entire capture pipeline reports started, and the SR engine itself takes
~1s to warm.

**Design.**
- Offscreen: `await audioCtx.resume()` (both contexts) before `mediaRecorder.start()`.
- Bar: start SpeechRecognition immediately on init (during the "loading" view), before
  sending START to offscreen, so SR warm-up overlaps stream acquisition instead of
  following it. SR results before recording-start get clamped to t=0.

## 8. Smarter evidence correlation + respect "attach recording"

- Build an explicit **evidence manifest** for the agent: every available signal
  (distinct keyframes with timestamps, annotated screenshot, transcript as its own
  labeled draft block, console/network events, page URL) plus which files CAN be
  attached. The recording is only attachable when `includeVideo` is true (hard rule).
- `create_issue` gains `attach` (array of filenames from the manifest): the agent picks
  the minimal evidence set that proves the issue (e.g. before/after frames, the
  annotated shot). Omitted → today's lean heuristic stays as the fallback.
- Vision input: up to 8 distinct frames (was 5) so correlation has more to work with.

## 9. Tickets can be created with no tracker connected (stale account state)

Add `GET /api/me` (bearer-token CORS route): `{ ok, tracker: "linear"|"jira"|null }`.
Popup `bcRefresh` calls it on open: 401 → clear the stored token (the `clearCloudToken`
that exists but is never called) and show connect; `tracker: null` → keep the briefs UI
but disable "Create ticket" with a "connect a tracker" notice linking to the web app.
Network failure → keep last-known state (don't block offline users).

## 10. "Create ticket" always opens a new tickets tab

Popup helper `openTicketsTab()`: `chrome.tabs.query` for `${APP_URL}/tickets*`; if found,
focus its window + `chrome.tabs.update(active)` + `chrome.tabs.reload`; else
`chrome.tabs.create`. Used by both the post-queue open and the "Brief Cloud" button.
(The per-ticket `open-url` background handler keeps opening new tabs — those are
external tracker URLs.)

## Testing

- Unit (vitest, existing): identifier chunking, write-back diffing, evidence manifest
  building, Jira transition/custom-field mapping, fuzzy name resolution.
- `tsc` clean; extension is plain JS (manual verification path documented in the PR).
- No live tracker calls in tests (mock fetch as the existing jira/linear tests do).

## Out of scope

Real remote MCP servers (OAuth audience problem), batching the archive/delete API,
mobile/responsive work.
