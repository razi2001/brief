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

## 6b. Set sensible metadata on `save_issue` — go direct, don't research

Fill basic fields on the create call so the ticket isn't bare. **Do NOT call `list_issues`, `list_issue_labels`, or sample the team's recent tickets first — that research dance is slow and almost always wasteful.** Use the defaults below; the user can re-triage in the tracker in one click if a default is wrong.

Defaults — apply directly, no listing:

- **priority** — `3` (Medium) for bugs, `4` (Low) for features. Bump to `2` (High) only if the brief description explicitly says "broken" / "blocked" / "can't ship" / "data loss" / similar urgent language. Never leave a bug at `0` (None).
- **labels** — pass `['Bug']` for bugs, `['Feature']` for features. That's it. Linear's `save_issue.labels` accepts names — if the team doesn't have a label by that name, Linear ignores it silently, no listing required. **Do not pass area labels** (`checkout`, `auth`, etc.) — you don't know what exists and inferring them costs a `list_issue_labels` call per sub-agent, which is exactly the slowness this rule is fixing.
- **state** — **leave unset.** Linear's `save_issue` will use the team's default new-ticket state automatically. Don't try to pick one.
- **assignee** — **leave unset.** Triage owner picks the assignee, not you.
- **cycle / project / milestone / estimate / due date** — **leave unset.** Refinement adds these later.

That's it. Two fields (`priority`, `labels`) — both inferred from the brief's classification (Step 1) without any tracker round-trips.

**The bar:** the ticket lands with a sensible priority and a type label, ready for the team's normal triage pass. It should NOT be a research project.

Mention the priority + label in the closing summary (Step 8) so the user can spot a miss in one glance.

## 7. Upload + embed images INLINE

The user wants images to **render in the ticket**, not just appear as a chip in the attachments list. The flow on Linear (adapt for other MCPs):

**Order of operations — strict:**

1. Create the issue first with `save_issue(...)`. Use a placeholder Evidence section (e.g. `**Evidence**\n_uploading…_`) — you'll rewrite the description in step 4 with the real `assetUrl`s. Linear needs an issue identifier before it'll accept uploads.
2. For each image (selected keyframes **and/or** `screenshot.png`) and, if you decided to attach it, `recording.webm`:
   a. `prepare_attachment_upload({ issue: 'LIN-123', filename: 'keyframe-002.png', contentType: 'image/png', size: <exact bytes> })` returns `{ uploadRequest: { url, headers }, assetUrl }`. Note the **nested `uploadRequest`** — it is NOT a flat `uploadUrl` at the top level.
   b. PUT the raw bytes to `uploadRequest.url`. **Send every header in `uploadRequest.headers` verbatim — same names, same casing, same values.** Omitting one (or changing the case) returns HTTP 403 from Google's signed-URL backend. Do not base64-encode the bytes. The signed URL expires after 60 seconds, so PUT immediately after `prepare_attachment_upload`; if it expires, re-call `prepare_attachment_upload` for a fresh signed URL.
   c. `create_attachment_from_upload({ issue: 'LIN-123', assetUrl, title: filename })` to register the upload as a Linear attachment row. **You must call this** — without it the file is uploaded to storage but Linear has no attachment record, the description embed will 404, and the file effectively doesn't exist as far as the ticket is concerned.
3. Collect the returned `assetUrl`s, one per file. **Use `assetUrl`, never `uploadRequest.url`, in the description.** This is the single most common upload bug:

   ```
   prepare_attachment_upload → {
     uploadRequest: {
       url: "https://uploads.linear.app/<bucket>/<obj>/<file>?X-Goog-Signature=…"  ← SIGNED PUT URL, expires in 60s, returns {"error":"not found"} after that
       headers: { … }
     },
     assetUrl: "https://uploads.linear.app/<assetId>"                              ← PERMANENT, this is what goes in the description
   }
   ```

   If you see `{"error":"not found"}` when opening an embedded image/video URL, you embedded `uploadRequest.url` instead of `assetUrl`. Fix the description (step 4) to use `assetUrl`.
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

After the ticket is successfully filed, delete the brief's entire folder from disk — that removes the main zip, the companion `-extra.zip`, and anything you extracted into it in one shot. Pick the form that matches your environment:

```bash
# macOS / Linux (real Linux, not WSL touching a Windows volume)
rm -rf ~/Downloads/brief/brief-<id>/
```

```powershell
# Native Windows (PowerShell). -Force strips Chrome's Mark-of-the-Web
# read-only attribute that otherwise blocks deletion.
Remove-Item -Recurse -Force "$env:USERPROFILE\Downloads\brief\brief-<id>"
```

```bash
# WSL / Linux container reading a Windows Downloads folder (e.g. /mnt/c/Users/<u>/Downloads)
# Plain rm -rf and chmod CAN'T strip Windows NTFS Mark-of-the-Web — you'll see "Permission
# denied" or "Operation not permitted". Shell out to Windows PowerShell via interop instead;
# that runs as a Windows process and is allowed to clear the attribute:
powershell.exe -Command "Remove-Item -Recurse -Force \"\$env:USERPROFILE\Downloads\brief\brief-<id>\""
```

**Why the WSL form looks weird:** Chrome attaches an NTFS alternate data stream (`:Zone.Identifier`, aka Mark-of-the-Web) plus a read-only flag to every downloaded file. From inside Linux, the kernel sees the read-only state but has no permission to clear the NTFS-side attribute, so `rm -rf` and `chmod` both fail. `powershell.exe` runs in Windows-land and can strip it.

The user does NOT want old briefs accumulating in their Downloads folder — the ticket is the permanent artifact now, the brief was just the input. **Only delete if the ticket filing was confirmed successful.** If anything went wrong (MCP error, network failure, ambiguous request), leave the brief's folder in place and tell the user what failed so they can retry.
