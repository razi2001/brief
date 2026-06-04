---
name: brief
description: Use this skill whenever the user mentions a "brief" or asks to "process my inbox" — turns recorded/screenshot/text briefs in ~/Downloads/brief/ into real Linear tickets, then deletes the source briefs. Works for one brief or a whole inbox; same flow with N=1.
---

# Brief

Briefs are captured by the Brief Chrome extension and live in `~/Downloads/brief/` as `brief-<id>.zip` (yet-to-extract) or `brief-<id>/` (already extracted). Each one — or a deduped group — becomes one Linear ticket. Your job: parse, file, clean up, report URLs. No mid-flow questions. Narrate progress as you go.

A brief can contain any combination of:

- **`recording.webm`** + sampled `keyframes/*.png` + `transcript` / `transcriptChunks` — only when `brief.json.recording` exists. Never assume a recording is there.
- **`screenshot.png`** — when `hasScreenshot: true`. Any red markings were drawn by the user to point at the issue. Center the ticket on what they highlight.
- **`description`** (in `brief.json`) — the user's own words. If present, it's the most authoritative statement of intent. Lead with it.
- **`extra`** — key/value pairs to render verbatim in an Additional data section.
- a companion `brief-<id>-extra.zip` with an extra screenshot/description added after recording — extract it too, merge into the same ticket.

## Hard rules

1. **Never ask which team / project.** Infer it. State the inference in the closing summary so the user can redirect with one word.
2. **Never ask "should I proceed?".** No confirmation gates. File the tickets, then summarize.
3. **Never mention the Brief extension, brief IDs, or file paths in the ticket itself.** Tickets read like a human wrote them.
4. **Embed every image and the recording inline** via markdown — never leave the ticket as a list of bare attachments.
5. **One short progress line per phase.** Not silence, not a wall of text — `Found 2 briefs.` / `Filing 2/2…` / `Done.`
6. **Only delete a brief if its ticket filed successfully.** Partial failure → leave that brief, keep going, report what failed at the end.

## Tracker: Linear

This skill targets Linear via its MCP. The four operations you need:

- `list_teams` → cache team name→id map **once** per run.
- `save_issue` (no `id`) → create issue. Returns the new issue's `id` and `url`.
- Attach: `prepare_attachment_upload(issueId, filename, contentType, size)` → returns `uploadUrl`, `assetUrl`, `headers` → PUT bytes to `uploadUrl` with those headers **verbatim** → `create_attachment_from_upload(issueId, assetUrl, filename)` to register it. The bare `assetUrl` (no signature query) is what goes in the inline markdown — Linear re-signs on read.
- `save_issue` (with `id`) → update the description to swap a placeholder for the real inline markdown.

---

## Phase 0 — Bootstrap (once per run)

Narrate: **`Probing tracker…`**

- Call `list_teams` exactly once. Cache the name→id map for the whole run.
- This holds whether the run is one brief or a whole inbox.

## Phase 1 — Discover & parse

Narrate: **`Found N briefs.`** (or `Inbox is empty.` and stop)

- If the user named brief IDs (or one ID), use that set. If the prompt also gave each a user-given name, keep those names — they're strong title hints.
- Otherwise list `~/Downloads/brief/`:
  ```bash
  ls ~/Downloads/brief/
  ```
- For each brief in the set:
  1. Extract `brief-<id>.zip` if no matching folder exists yet. If `brief-<id>-extra.zip` exists alongside, extract it too.
  2. Read `brief.json` only (not keyframes yet). Collect: `id`, `pageUrl`, `pageTitle`, `transcript`, `transcriptChunks`, `keyframeMeta`, `events`, `description`, `hasScreenshot`, `screenshotAnnotated`, `extra`, `recording`.

If a brief ID named in the prompt isn't on disk, note it in the closing summary and skip — don't error.

## Phase 2 — Triage (silent)

Narrate: **`Triaging…`** then **`N tickets to file (M deduped).`**

For each brief, decide silently — no confirmation step:

- **Bug vs. feature.** Bug if any of: words like "broken", "doesn't work", "should be", "expected"; red annotation marks something visibly wrong; `events` contains `console-error` / `js-error` / `network-error`; the same click repeats without UI change. Else feature.
- **Team.** Match in this order:
  1. `pageUrl` host + path vs. cached team names (e.g. `app.acme.com/billing` → Billing).
  2. Keywords from `description` / `transcript`.
  3. The user's most recently used team.
- **Dedupe.** Group briefs that share `pageUrl` AND overlapping transcript topic, OR share the same console error. A group becomes one ticket: best title across the group, evidence merged from every contributing brief, source brief ids tracked internally only (never in the ticket body).

## Phase 3 — File each ticket (evidence-first)

For each ticket, narrate: **`Filing K/N — <short title>…`**

### Read evidence

- **Screenshot-only or text-only brief** → no keyframes. The screenshot and/or description ARE the evidence.
- **Recording brief** → tier the keyframe pass:
  - If `recording.durationMs < 12000` AND `events` is empty AND the transcript reads as pure narration ("the X should be Y") → read **1 frame** (`keyframe-000`).
  - Otherwise → binary-search **3–5 frames**: first, last, then midpoint of any pair that differs. Stop at 5 unless something is genuinely unclear.
- For each chosen frame, pull `transcriptChunks` within ±2000ms of its `timestamp` — that's the caption. Treat the transcript as a draft: silently correct obvious mis-transcriptions using on-screen text as ground truth.

### Pull error events (bugs only)

Filter `events` for `console-error` / `js-error` → verbatim in **Console**. Filter for `network-error` → one line each in **Network** (method, URL, status or failure reason). Omit either section entirely if empty — don't write "No errors".

### Write the ticket body

**Title** — one sentence. Imperative for bugs ("Pay button silently fails on /checkout"), noun phrase for features ("Add CSV export to invoices view"). If the prompt supplied a user-given brief name, anchor on it.

**Body — bug:**

```markdown
**Context**
Page: <pageUrl>
Browser: <derived from userAgent>

**Steps to reproduce**
1. Go to <page>
2. <derived from events, e.g. "Click 'Pay $29' (button#pay.primary)">
3. …

**What happens**
<from description / transcript: user's account of the failure>

**Expected**
<explicit if stated; inferred briefly otherwise>

**Console**
```
<console-error / js-error events verbatim>
```

**Network**
<failed requests, one per line: method, URL, status or failure reason>

**Evidence**

![Frame at 0:02 — checkout page before click](<assetUrl-000>)
> "<transcript chunk near 0:02>"

![Frame at 0:06 — no feedback after click](<assetUrl-002>)
> "<transcript chunk near 0:06>"

**Recording**

![Recording](<recording-assetUrl>)

**Additional data**
<each `extra` pair as `**<key>**: <value>`>
```

**Body — feature:**

```markdown
**What**
<one-paragraph summary from description / transcript>

**Why**
<motivation if mentioned>

**Where**
Page: <pageUrl>

**Notes / sketches**
![Frame at 0:04 — where it should appear](<assetUrl-001>)
> "<transcript chunk near 0:04>"

**Additional data**
<each `extra` pair as `**<key>**: <value>`>
```

Omit any section with no content (Console, Network, Recording, Additional data). Don't write "N/A".

### Create + attach + embed (parallel within a ticket)

1. `save_issue` to create the ticket with a placeholder Evidence section (e.g. `_uploading…_`).
2. For every image (selected keyframes + `screenshot.png` if `hasScreenshot`) and the recording (when attaching — see below), run `prepare_attachment_upload` → PUT → `create_attachment_from_upload` **in parallel** — they don't depend on each other once the issue exists.
3. `save_issue` (with `id`) once more to replace the placeholder with the real inline markdown using the bare `assetUrl` for each piece.

**The user's `screenshot.png`** — embed inline in Evidence whenever `hasScreenshot` is true. If `screenshotAnnotated`, caption it to point at the red ("The red circle marks the nav label that should be plural"). For a screenshot-only brief, this is the only evidence image.

### Attach the recording? (decision)

Recording exists only when `brief.json.recording` is present. **Default is don't attach.**

**Attach when** any of:
- Motion or timing matters — jank, flash, race condition, layout jump, scroll glitch, broken transition.
- The repro is a multi-step interaction hard to convey in stills (drag-and-drop, multi-field form flow, hover/focus sequence).
- The keyframe sampling missed the exact failure moment.
- The user's voice references something dynamic ("watch how it stutters when I click").
- The prompt explicitly says the user ticked "attach the recording to this ticket" for this brief — always attach in that case.

**Skip when** the bug is static (wrong text, broken layout, missing button, bad color), keyframes already show before/after clearly, or it's a feature request without an on-screen repro. In those cases don't mention the recording — the stills carry it.

When attaching: same `prepare_attachment_upload` → PUT → `create_attachment_from_upload` flow with `'video/webm'` content type. Place the inline markdown right after Evidence (bugs) or Notes (features). Linear renders an inline player from a video `assetUrl`.

## Phase 4 — Clean up and report

**If every ticket in the run filed successfully:**

```bash
rm -rf ~/Downloads/brief/*
```

**If anything failed:** leave the folder alone. Don't try to delete just the successful briefs individually — keep the inbox intact so the user has a clean recovery point.

**Closing summary** — one message, URLs on every line:

> Done. Filed:
> - <url> — <title> (<team>)
> - <url> — <title> (<team>)
>
> If a team is wrong, just say which.

If everything went to one team, collapse to `Done. Filed in **<team>**:` with one URL per line.

If any brief was skipped (missing from disk, ticket-creation failed, etc.), list those at the bottom under **Retained for retry** with one line of why.

That's the whole report card. No "do you want me to…", no follow-up.
