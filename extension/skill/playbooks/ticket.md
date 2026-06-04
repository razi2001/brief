# Ticket Playbook

Goal: produce one high-quality ticket in the user's tracker (Linear / Jira / GitHub / Notion — whichever MCP is connected) with zero clarifying questions and images that render inline.

**Narrate as you go.** Before each phase below, write one short declarative line saying what you're about to do — `Reading brief.json…`, `Inferring team from app.acme.com/billing → Billing.`, `Sampling 4 keyframes…`, `Creating ticket…`, `Uploading 3 attachments in parallel…`, `Done.` Statements, never questions. Don't dump tool output — one line of intent per action. The user is watching; silence reads as stuck.

## 0. Read brief.json first — which inputs exist?

Narrate: **`Reading brief.json…`**

Always read `brief.json` before anything else. A brief can contain any combination of:

- **`description`** (string) — the user's own words about the issue. If present, it's the single most authoritative statement of intent. Lead with it.
- **`recording`** + `keyframes` + `transcript` — present only for recording briefs (`recording.webm` on disk, `keyframes/*.png`, and `transcript`/`transcriptChunks`). If absent, there is NO recording — skip steps 3–4 and don't look for keyframes.
- **`hasScreenshot: true`** — a `screenshot.png` is on disk. If `screenshotAnnotated` is true, **the red markings on it were drawn by the user to point at exactly where the issue is.** Center the ticket on what the red highlights. Describe the location in words too ("the red circle marks the nav item that should be plural").
- **`extra`** — key/value pairs (credentials, IDs, context) the user attached. Put them in an **Additional data** section verbatim.

If the prompt mentions a companion `brief-<id>-extra.zip`, unzip it too — it holds a screenshot and/or description the user added after recording. Merge its `screenshot.png` and `description` into the same ticket.

Use whatever is present, in this priority for understanding intent: description → red-annotated screenshot → transcript/keyframes → plain screenshot. A brief might be *only* a screenshot, or *only* a sentence of text — that's valid; file the best ticket you can from what's there. Never stall waiting for inputs that don't exist.

## 1. Classify

Quick read of `description`, `transcript`, and `events`:

- **Bug** if you see words like "broken", "doesn't work", "but it didn't", "should be", "expected"; OR if `events` contains `console-error` / `js-error` / `network-error`; OR if the same click happens twice without UI change; OR the red annotation marks something visibly wrong.
- **Feature / task** otherwise.

This determines structure (see step 6).

## 2. Pick the team / project — DO NOT ASK

Narrate: **`Listing teams…`** then **`Inferring team: <chosen team> (from <signal>).`**

Order of preference:

1. **Tracker MCP team listing.** Call `list_teams()` / equivalent. Look for a name that matches:
   - The `pageUrl` host's product area (e.g. `app.acme.com/billing` → "Billing" team)
   - Keywords from `description` / `transcript` ("checkout", "auth", "search"…)
   - Existing label conventions
2. **Repo CODEOWNERS** if you're in a repo.
3. **Most recently used team** by querying recent issues from this user.

Pick the best match confidently. **State the chosen team in your final summary** so the user can redirect with one word if wrong. Never ask up front. In the inbox flow `list_teams` has already been called and the result is cached — don't call it again per ticket.

## 3. Read keyframes — binary search (recording briefs only)

Narrate: **`Sampling keyframes…`** (or skip the line entirely if there's no recording).

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

## 7. Upload + embed images INLINE

Narrate: **`Creating ticket…`** then **`Uploading N attachments in parallel…`** then **`Updating ticket with inline media…`**

The user wants images to **render in the ticket**, not appear as a list of file attachments. The flow on Linear (adapt for other MCPs):

For each image you're using — selected keyframes **and/or** the user's `screenshot.png`:

1. `prepare_attachment_upload(issueId, filename, contentType, size)` → returns `uploadUrl`, `assetUrl`, `headers`
2. PUT the image bytes to `uploadUrl` with those headers
3. `create_attachment_from_upload(issueId, assetUrl, filename)` to register it
4. **Use the `assetUrl` inline in the markdown description**: `![caption](assetUrl)`

Create the issue FIRST (with a placeholder Evidence section like `_uploading…_`), then run the prepare→PUT→register flow for every attachment **in parallel** — they don't depend on each other once the issue exists. Then do a single update call to swap the placeholder for the real inline markdown.

**The user's screenshot.** If `brief.json.hasScreenshot` is true, embed `screenshot.png` inline in Evidence — it's often the single most important image. If `screenshotAnnotated`, caption it to point at the red, e.g. `![The red circle marks the nav label that should be plural](assetUrl)`. For a screenshot-only brief, this is your primary (often only) evidence image.

### The recording

A recording exists ONLY if `brief.json` has a `recording` field (and `recording.webm` is on disk). Screenshot-only and text-only briefs have none — skip this section for them.

**If the prompt marks a brief with `[+recording]`** (the user ticked the "attach recording" toggle at export time — it appears right after the brief id, e.g. `mpztxhn5-1f3t36 ("id1") [+recording]`), then ALWAYS attach the recording for that brief, regardless of the judgment below. The user asked explicitly.

Otherwise, you decide. **Attach it only when the video genuinely beats the keyframes** — don't attach by default, and don't attach just because it exists.

Attach the recording when:
- The bug is about **motion or timing**: a janky animation, a flash, a race condition, a layout that jumps, scroll jank, a transition that breaks
- The repro is a **multi-step interaction** that's hard to convey with a few stills (drag-and-drop, a multi-field form flow, a hover/focus sequence)
- The keyframes **miss the moment** — the sampling (every 2s) didn't capture the exact frame where it breaks
- The user's **voice explanation references something dynamic** ("watch how it stutters when I click here")

Skip the recording (keyframes alone are enough) when:
- It's a **static** bug — wrong text, broken layout, missing button, bad color, a value that's incorrect. A screenshot says everything.
- The keyframes already show the before/after clearly
- It's a **feature request** with no specific on-screen repro

When you do include it, **embed it inline in the description so it renders as a player** — don't just leave a "see attached" line. When you don't, don't mention it at all — the keyframes carry the ticket.

To embed inline: use the same upload flow as keyframes — `prepare_attachment_upload(issueId, 'recording.webm', 'video/webm', size)` → PUT the bytes to `uploadUrl` → `create_attachment_from_upload(issueId, assetUrl, 'recording.webm')`. Then put the `assetUrl` **inline in the description markdown** in a Recording section:

```markdown
**Recording**

![Recording](<assetUrl>)
```

Linear (and most modern trackers) render an inline player from a video `assetUrl` — that's what makes it show in the preview instead of only in the Resources/attachments list. Do NOT also write a separate "see attached recording.webm" line — the inline player is enough. Place the Recording section right after Evidence (bugs) or Notes (features).

If a particular tracker genuinely can't render video inline, fall back to a single `**Recording**: see attached recording.webm` line — but try the inline embed first.

## 8. Clean up and report — solo ticket only

> **Inbox mode:** if this ticket is being filed as part of an inbox batch, **stop here**. Don't delete anything and don't post a closing summary — `inbox.md` handles cleanup (Step 5) and the single closing summary (Step 6) for the whole batch. Just return control with the ticket URL captured.

### 8a. Delete the brief (solo only)

Narrate: **`Deleting source brief…`**

After the ticket is successfully filed, delete the source brief from disk:

```bash
rm -rf ~/Downloads/brief/brief-<id>.zip
rm -rf ~/Downloads/brief/brief-<id>-extra.zip
rm -rf ~/Downloads/brief/brief-<id>/
```

The user does NOT want old briefs accumulating in their Downloads folder — the ticket is the permanent artifact now, the brief was just the input. **Only delete if the ticket filing was confirmed successful.** If anything went wrong (MCP error, network failure, ambiguous request), leave the brief in place and tell the user what failed so they can retry.

### 8b. Closing summary with the ticket URL (solo only)

End with one short message. **The URL goes on its own line so it's unmissable.**

> Done. Filed in **<team>**:
> <url>
> <title>

Then a single optional line for traceability if it adds value: `Used N frames + Y transcript chunks.` Skip it if it doesn't.

Close with:

> If <team> isn't right, just tell me.

That's it. No mid-flow questions. No "do you want me to attach the video?". You decided, you executed, you reported.
