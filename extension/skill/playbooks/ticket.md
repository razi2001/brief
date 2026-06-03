# Ticket Playbook

Goal: produce one high-quality ticket in the user's tracker (Linear / Jira / GitHub / Notion — whichever MCP is connected) with zero clarifying questions and images that render inline.

## 0. Read brief.json first — which inputs exist?

Always read `brief.json` before anything else. A brief can contain any combination of:

- **`description`** (string) — the user's own words about the issue. If present, it's the single most authoritative statement of intent. Lead with it.
- **`recording`** + `keyframes` + `transcript` — present only for recording briefs (`recording.webm` on disk, `keyframes/*.png`, and `transcript`/`transcriptChunks`). If absent, there is NO recording — skip steps 3–4 and don't look for keyframes.
- **`hasScreenshot: true`** — a `screenshot.png` is on disk. If `screenshotAnnotated` is true, **the red markings on it were drawn by the user to point at exactly where the issue is.** Center the ticket on what the red highlights. Describe the location in words too ("the red circle marks the nav item that should be plural").
- **`extra`** — key/value pairs (credentials, IDs, context) the user attached. Put them in an **Additional data** section verbatim.

Each brief lives in its own folder: `~/Downloads/brief/brief-<id>/`. Inside you'll find the main `brief-<id>.zip` and, when present, a companion `brief-<id>-extra.zip`. **Always check for the companion and unzip it if it exists** — the prompt won't mention it. The companion holds anything the user added *after* the recording was saved: a screenshot, a typed description, additional key/value data, and an `attachRecording` flag for whether to attach `recording.webm` to the ticket. Treat the companion's fields as the source of truth — merge them over the main `brief.json` (companion wins on conflict).

Use whatever is present, in this priority for understanding intent: description → red-annotated screenshot → transcript/keyframes → plain screenshot. A brief might be *only* a screenshot, or *only* a sentence of text — that's valid; file the best ticket you can from what's there. Never stall waiting for inputs that don't exist.

## 1. Classify

Quick read of `description`, `transcript`, and `events`:

- **Bug** if you see words like "broken", "doesn't work", "but it didn't", "should be", "expected"; OR if `events` contains `console-error` / `js-error` / `network-error`; OR if the same click happens twice without UI change; OR the red annotation marks something visibly wrong.
- **Feature / task** otherwise.

This determines structure (see step 6).

## 2. Pick the team / project — DO NOT ASK

Order of preference:

1. **Tracker MCP team listing.** Call `list_teams()` / equivalent. Look for a name that matches:
   - The `pageUrl` host's product area (e.g. `app.acme.com/billing` → "Billing" team)
   - Keywords from `description` / `transcript` ("checkout", "auth", "search"…)
   - Existing label conventions
2. **Repo CODEOWNERS** if you're in a repo.
3. **Most recently used team** by querying recent issues from this user.

Pick the best match confidently. **State the chosen team in your final summary** so the user can redirect with one word if wrong. Never ask up front.

## 3. Read keyframes — binary search (recording briefs only)

**Skip this entirely if there's no recording.** For a screenshot-only or text-only brief, the screenshot and/or description are your evidence — go to step 5/6.

Do NOT read every keyframe. The typical recording has 10–30 frames; most are redundant.

```
1. Read keyframe-000 (start state)
2. Read the LAST keyframe (end state)
3. If they look identical: sample the middle frame. Done.
4. If different: read the midpoint between any two adjacent-different frames
   to find the moment of change. Recurse on the half that changed.
5. Stop at 3–5 frames total unless something is genuinely unclear.
```

You're trying to find the moments of state change, not narrate every second.

## 4. Map transcript chunks to frames (recording briefs only)

For each frame you decided to use (step 3), look at `transcriptChunks` and pull any chunk whose `tMs` is within ±2000ms of the frame's `timestamp`. That text is what the user was saying while showing that visual. Use it to write the caption / context for the frame.

If a chunk has no nearby frame, treat it as ambient narration.

## 5. Pull console / JS / network errors if present

Filter `events` for `type === 'console-error'` or `'js-error'` → put these verbatim in a **Console** section. Filter for `type === 'network-error'` (failed requests / non-2xx responses captured during the recording) → put these in a **Network** section, one line each: method, URL, and status or failure reason (e.g. `POST /api/checkout → 500` or `GET /api/user → failed (network error)`). These are high-signal for bugs — include them. If a category has none, skip that section entirely (don't write "No errors").

## 6. Write the ticket

### Title

One sentence, from the user's main complaint or the user's desired outcome. Imperative for bugs ("Pay button silently fails on /checkout"), noun phrase for features ("Add CSV export to invoices view").

### Description structure

**For bugs:**

```markdown
**Context**
Page: <pageUrl>
Browser: <derived from userAgent>

**Steps to reproduce**
1. Go to <page>
2. <derived from events, e.g. "Click 'Pay $29' (button#pay.primary)">
3. <next event>
...

**What happens**
<from transcript: user's description of the failure>

**Expected**
<from transcript "I'd expect…" / "should be…" parts; if missing, infer briefly>

**Console**
```
<console-error / js-error events verbatim>
```

**Network**
<failed requests: method, URL, status/reason — one per line; omit section if none>

**Evidence**

![Frame at 0:02 — checkout page before click](assetUrl-000)
> "<transcript chunk near 0:02>"

![Frame at 0:06 — no feedback after click](assetUrl-002)
> "<transcript chunk near 0:06>"

**Additional data**
<only if the user supplied key/value extras — render each as `**<key>**: <value>`; omit the whole section if none>
```

**For features:**

```markdown
**What**
<one-paragraph summary derived from transcript>

**Why**
<motivation from transcript, if mentioned>

**Where**
Page: <pageUrl>

**Notes / sketches**
![Frame at 0:04 — where it should appear](assetUrl-001)
> "<transcript chunk near 0:04>"

**Additional data**
<only if the user supplied key/value extras; otherwise omit>
```

## 6b. File the ticket in a **good state** — mirror team conventions

A bare title + description is not enough. A ticket the team can actually triage needs the metadata fields filled the same way the team already fills them for new tickets. Match what they do; don't invent your own conventions.

**Before calling `save_issue`, sample 5–10 of the team's most recently-created tickets** (use `list_issues({ team, orderBy: 'createdAt', limit: 10 })` on Linear, equivalent on other trackers). Read off the pattern:

- **state / status** — what state are newly-created tickets in? Backlog, Triage, Todo, To Refine? Don't default to "In Progress" or "Done". If the team has a dedicated intake state (Triage, Backlog), use it.
- **priority** — Linear: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low. For a bug, mirror what comparable bugs got. If unsure, **3 (Medium) for bugs, 4 (Low) for feature requests** — never leave a bug at None when most bugs in the team are triaged with a priority.
- **labels** — almost every team uses a `Bug` / `Feature` / `Improvement` axis plus area labels (`checkout`, `auth`, `mobile`, …). Apply the type label (Bug vs Feature based on your step-1 classification) and the area label that best matches the `pageUrl` host and the inferred surface. If you're not sure a label exists, call `list_issue_labels({ team })` first — don't invent labels.
- **cycle** — is the team active in a cycle right now? If new bugs typically get dropped into the current cycle, do that; if they go into the backlog and get pulled in later, leave cycle unset. Read recent tickets to tell which.
- **project / milestone** — same rule: if recent tickets in this surface area are tagged with a project, match it. If unset is the norm, leave it.
- **estimate / complexity** — if the team estimates at creation time, give a conservative starting estimate based on apparent scope (UI copy fix → smallest unit; multi-file refactor → larger). If estimates are added later in refinement, leave unset.
- **assignee** — leave UNSET by default. Only set an assignee if the team's recent tickets show a clear auto-assign pattern (e.g. always assigned to the area owner). Filing a ticket onto a specific person without that signal is presumptuous.
- **severity** — if the team uses a custom Severity field or label (S1/S2/S3, P0/P1/P2), apply the same calibration: data loss / outage = top severity; broken core flow = high; cosmetic = low.
- **due date** — only set if recent tickets do so as a matter of course (rare). Otherwise unset.

**The bar:** the freshly-filed ticket should be indistinguishable from one a team member would have filed manually. If a teammate opening the tracker can't tell which of the last 10 tickets the bot filed, you got it right.

If a particular field doesn't fit cleanly into the MCP's `save_issue` schema (Linear's custom-field support is limited, etc.), apply it as a label in the form `severity:high` or `complexity:medium` — that's the standard workaround and the team's existing tickets will tell you whether they actually do this.

State the metadata you applied in the final summary (Step 8), so the user can correct any miss with one word.

## 7. Upload + embed images INLINE

The user wants images to **render in the ticket**, not just appear as a chip in the attachments list. The flow on Linear (adapt for other MCPs):

**Order of operations — strict:**

1. Create the issue first with `save_issue(...)`. Use a placeholder Evidence section (e.g. `**Evidence**\n_uploading…_`) — you'll rewrite the description in step 4 with the real `assetUrl`s. Linear needs an issue identifier before it'll accept uploads.
2. For each image (selected keyframes **and/or** `screenshot.png`) and, if you decided to attach it, `recording.webm`:
   a. `prepare_attachment_upload({ issue: 'LIN-123', filename: 'keyframe-002.png', contentType: 'image/png', size: <exact bytes> })` returns `{ uploadRequest: { url, headers }, assetUrl }`. Note the **nested `uploadRequest`** — it is NOT a flat `uploadUrl` at the top level.
   b. PUT the raw bytes to `uploadRequest.url`. **Send every header in `uploadRequest.headers` verbatim — same names, same casing, same values.** Omitting one (or changing the case) returns HTTP 403 from Google's signed-URL backend. Do not base64-encode the bytes. The signed URL expires after 60 seconds, so PUT immediately after `prepare_attachment_upload`; if it expires, re-call `prepare_attachment_upload` for a fresh signed URL.
   c. `create_attachment_from_upload({ issue: 'LIN-123', assetUrl, title: filename })` to register the upload as a Linear attachment row. **You must call this** — without it the file is uploaded to storage but Linear has no attachment record and the asset URL won't render reliably inline.
3. Collect the returned `assetUrl`s, one per file.
4. Call `save_issue({ id: 'LIN-123', description: <final markdown> })` once, with the real `assetUrl`s embedded inline:
   - **Images:** `![caption](assetUrl)` — Linear renders these as inline images.
   - **Video (`recording.webm`):** put the bare `assetUrl` on its own line inside the Recording section (see below). Linear's renderer auto-embeds Linear-hosted video URLs as a player; the markdown image syntax `![](url)` does **not** work for video.

For the curl/fetch equivalent of the PUT (in case you need to debug a 403):

```bash
curl -X PUT --data-binary @keyframe-002.png \
  -H "content-type: image/png" \
  -H "x-goog-content-length-range: 12345,12345" \
  -H "cache-control: public, max-age=31536000" \
  -H 'Content-Disposition: attachment; filename="keyframe-002.png"' \
  "<uploadRequest.url>"
```

(Exact header set comes from `uploadRequest.headers` — that's just an example shape. Don't hardcode it.)

**The user's screenshot.** If `brief.json.hasScreenshot` is true, embed `screenshot.png` inline in Evidence — it's often the single most important image. If `screenshotAnnotated`, caption it to point at the red, e.g. `![The red circle marks the nav label that should be plural](assetUrl)`. For a screenshot-only brief, this is your primary (often only) evidence image.

**Don't use the deprecated `create_attachment` (base64) tool** unless `prepare_attachment_upload` is genuinely unavailable. Base64-uploading large recordings will blow up the agent context.

### The recording

A recording exists ONLY if `brief.json` has a `recording` field (and `recording.webm` is on disk). Screenshot-only and text-only briefs have none — skip this section for them.

**If `attachRecording: true` is set in the companion `brief-<id>-extra.zip`'s `brief.json`**, then ALWAYS attach the recording for that brief, regardless of the judgment below. The user explicitly asked for it via the popup checkbox — that flag is the on-disk record of their choice.

Otherwise (the flag is false or absent), you decide. **Attach it only when the video genuinely beats the keyframes** — don't attach by default, and don't attach just because it exists.

Attach the recording when:
- The bug is about **motion or timing**: a janky animation, a flash, a race condition, a layout that jumps, scroll jank, a transition that breaks
- The repro is a **multi-step interaction** that's hard to convey with a few stills (drag-and-drop, a multi-field form flow, a hover/focus sequence)
- The keyframes **miss the moment** — the sampling (every 2s) didn't capture the exact frame where it breaks
- The user's **voice explanation references something dynamic** ("watch how it stutters when I click here")

Skip the recording (keyframes alone are enough) when:
- It's a **static** bug — wrong text, broken layout, missing button, bad color, a value that's incorrect. A screenshot says everything.
- The keyframes already show the before/after clearly
- It's a **feature request** with no specific on-screen repro

When you do include it, **embed it inline so it renders as a player** — don't just leave a "see attached" line. When you don't, don't mention it at all — the keyframes carry the ticket.

To embed inline, use the same upload flow as keyframes — `prepare_attachment_upload({ issue, filename: 'recording.webm', contentType: 'video/webm', size })` → PUT the bytes to `uploadRequest.url` with every header in `uploadRequest.headers` (verbatim, case-preserved) → `create_attachment_from_upload({ issue, assetUrl, title: 'recording.webm' })`. Then in the description, write the Recording section like this — **the assetUrl must be on its own line, with blank lines around it, and as a bare URL (no markdown image syntax, no `![]()` wrapper, no link wrapper)**:

```markdown
**Recording**

<assetUrl>
```

Linear's renderer auto-embeds Linear-hosted video URLs into an inline player. `![Recording](assetUrl)` does **not** work for video — it renders as a broken-image icon, which is what produces the "image attached weird, video not attached" symptom. A wrapped link `[Recording](assetUrl)` renders as a clickable link, not a player. Bare URL on its own line is the correct form.

Place the Recording section right after Evidence (bugs) or Notes (features). Do NOT also write a separate "see attached recording.webm" line — the inline player + the attachment row from `create_attachment_from_upload` are enough.

If a particular tracker genuinely can't auto-embed video, fall back to a single `**Recording**: <assetUrl>` line — but try the bare-URL embed first, it's what Linear expects.

## 8. Confirm + clean up

End with one short summary line. Include the metadata you set (state, priority, labels) so the user can spot a miss in one glance:

> Filed **<title>** in **<team>** → <url>. State: Triage · Priority: Medium · Labels: Bug, checkout. Used N frames + Y transcript chunks. If anything's off (team, priority, label), just tell me.

That's it. No mid-flow questions. No "do you want me to attach the video?". You decided, you executed, you reported.

## 9. Delete the brief

After the ticket is successfully filed, delete the brief's entire folder from disk — that removes the main zip, the companion `-extra.zip`, and anything you extracted into it in one shot. Pick the form that matches the platform you're on:

```bash
# macOS / Linux
rm -rf ~/Downloads/brief/brief-<id>/
```

```powershell
# Windows (PowerShell). -Force is REQUIRED — Chrome marks freshly-downloaded
# files read-only/hidden (Mark-of-the-Web), and plain Remove-Item refuses to
# delete those. -Force strips the attribute and removes them.
Remove-Item -Recurse -Force "$env:USERPROFILE\Downloads\brief\brief-<id>"
```

The user does NOT want old briefs accumulating in their Downloads folder — the ticket is the permanent artifact now, the brief was just the input. **Only delete if the ticket filing was confirmed successful.** If anything went wrong (MCP error, network failure, ambiguous request), leave the brief's folder in place and tell the user what failed so they can retry.
