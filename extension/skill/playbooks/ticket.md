# Ticket Playbook

Goal: produce one high-quality ticket in the user's tracker (Linear / Jira / GitHub / Notion — whichever MCP is connected) with zero clarifying questions and images that render inline.

**Narrate as you go.** Before each phase below, write one short declarative line saying what you're about to do — `Reading brief.json…`, `Inferring team from app.acme.com/billing → Billing.`, `Sampling 4 keyframes…`, `Creating ticket…`, `Uploading 3 attachments in parallel…`, `Done.` Statements, never questions. Don't dump tool output — one line of intent per action. The user is watching; silence reads as stuck.

## 0. Read brief.json first — which inputs exist?

Narrate: **`Reading brief.json…`**

**If a companion `brief-<id>-extra.zip` exists on disk, extract it and merge its `brief.json` on top of the recording's `brief.json`.** The companion carries post-record additions (description, screenshot, extra k/v pairs, the **`includeVideo`** attach-recording toggle) that the original brief.json — frozen when recording stopped — couldn't include. Companion values WIN on conflict; that's the whole point of writing one. After merging you have the canonical view of the brief.

Specifically watch for `includeVideo: true` in the merged result. That's the user's explicit "attach the recording to this ticket" toggle — it's a hard rule (see Step 8 "Attach the recording? (decision)"). Record it now so you don't lose it five steps later.

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

## 4. Map transcript chunks to frames (recording briefs only) — for YOUR understanding only

For each frame you decided to use (step 3), pull any `transcriptChunks` whose `tMs` is within ±2000ms of the frame's `timestamp`. **This is for you to understand what's happening in the frame.** The transcript text NEVER appears in the ticket — not as a quote, not as a caption, not as a blockquote, not anywhere. You use it to figure out the right neutral caption ("Checkout page after clicking Pay"), then you throw it away.

Treat the transcript as a draft: silently correct obvious mis-transcriptions using on-screen text as ground truth.

If a chunk has no nearby frame, use it as background context for the **What happens** / **Expected** sections — again, never quoted.

## 5. Pull console / JS / network errors if present

All event types live in `brief.json.events[]` with a `type` field. Filter as follows:

- `type === 'console-error'` → payload `{ args }` (whatever was passed to `console.error`). Put verbatim in **Console**.
- `type === 'js-error'` → payload `{ message, filename, lineno, colno }`. Format as `<message>  (<filename>:<lineno>:<colno>)` in **Console**.
- `type === 'promise-rejection'` → payload `{ reason }`. Format as `Unhandled promise rejection: <reason>` in **Console**.
- `type === 'network-error'` → payload `{ method, url, status, reason }`. One line each in **Network**: `<METHOD> <url> → <status or "failed (reason)">`.

These are high-signal for bugs — include them. If a category has no matching events, skip that section entirely. Never write "No errors" or "N/A".

## 6. Write the ticket

### Title

One sentence describing the bug or feature in neutral terms. Imperative for bugs ("Pay button silently fails on /checkout"), noun phrase for features ("Add CSV export to invoices view"). Never starts with "User wants…" or "Reporter says…".

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
<one or two neutral sentences describing the observed failure>

**Expected**
<one sentence; infer from context if not explicitly stated>

**Console**
```
<console-error / js-error / promise-rejection entries, one per line>
```

**Network**
<failed requests: one per line as "METHOD url → status (or failed: reason)">

**Evidence**

![Checkout page before clicking Pay](url-000)

![Checkout page after the click — no UI feedback, button still active](url-002)

**Additional data**
<only if the user supplied key/value extras — render each as `**<key>**: <value>`; omit the whole section if none>
```

**For features:**

```markdown
**Summary**
<one paragraph stating what the feature is and the behavior expected>

**Rationale**
<one or two sentences on why it's needed; omit if not clear>

**Where**
Page: <pageUrl>

**Notes**
![Where the new control should appear](url-001)

**Additional data**
<only if the user supplied key/value extras; otherwise omit>
```

Captions describe what's in the image — what the screen shows, what just happened. They never reference timestamps, frame numbers, or anything the reporter said.

## 7. Apply user guidance (if any)

Right before the `save_issue` call, check for a sidecar file written by the extension at export time:

```bash
cat ~/Downloads/brief/guidance.txt 2>/dev/null
```

- **File missing or empty** → no guidance set. Skip this section entirely and move on. Don't narrate, don't mention it.
- **File has content** → narrate **`Applying ticket guidance…`** and treat its lines as natural-language rules to fold into the `save_issue` arguments. In an inbox run, you'll re-read the same file for every ticket (one cheap `cat` per ticket) so it applies to every one.

### Mapping natural-language rules to `save_issue` fields

| User writes… | `save_issue` field |
|---|---|
| `Status: Backlog` / "open as backlog" / "draft" | `state: 'Backlog'` |
| `Priority: Medium` / "default to high" | `priority: 1\|2\|3\|4` (1 Urgent, 2 High, 3 Medium, 4 Low) |
| `Label every ticket "inbound"` / "tag with X" | `labels: ['X', …]` |
| `Assign to me` | `assignee: 'me'` |
| `Leave unassigned` | don't pass `assignee` |
| `Use the X project` / "milestone Y" | `project: 'X'` / `milestone: 'Y'` |
| `Never set a due date` | don't pass `dueDate` |
| `Bugs → Engineering, features → Product` | branch on the Step 1 bug/feature classification when picking the team in Step 2 |

### Conflict resolution

- **Per-brief signals win.** The `includeVideo: true` flag from the brief itself, and any per-brief judgment from earlier steps (e.g. the team you inferred from `pageUrl`), override conflicting guidance lines. Guidance is the user's default; the brief is the user's intent for this specific case.
- **Ambiguous rule** ("file under triage" with no triage label/project anywhere) → follow as best you can. If it can't be applied at all, do NOT ask — file the ticket without that field and note the deviation in the closing summary on its own line ("Couldn't apply `inbound` — that label doesn't exist in **Marketing**.").
- **Never silently drop a rule.** Either apply it or surface the deviation in the summary.

## 8. Upload + embed images INLINE

Narrate: **`Creating ticket…`** then **`Uploading N attachments in parallel…`** then **`Updating ticket with inline media…`**

The user wants images to **render in the ticket**, not appear as a list of file attachments. Use Linear's signed-URL upload flow — it's the preferred path per Linear's own docs and works for any file size (images and the recording alike).

### Verified facts (don't second-guess them)

- `prepare_attachment_upload(issue, filename, contentType, size)` returns `uploadRequest.url`, `uploadRequest.headers`, and `assetUrl`.
- PUT the raw bytes to `uploadRequest.url` with **every header from `uploadRequest.headers` verbatim** — same casing, same values. Any drift returns 403. The signed URL is valid for **60 seconds** — don't sit on it.
- `create_attachment_from_upload(issue, assetUrl, title)` registers it and returns `{id, title, url}`.
- The `url` Linear returns is **bare** (no query string). Embed it as-is in markdown — `![caption](url)`. When the description is read later, Linear automatically appends `?signature=<JWT>` with a 5-minute expiry. **You do NOT add the signature yourself.** Submit bare; Linear signs on every read. Don't be alarmed when a re-read shows a long `?signature=…` you didn't write — that's expected.
- The asset both renders inline at the markdown location AND appears in the issue's attachments list. Both surfaces showing the file is correct — don't try to suppress one or the other.

### Procedure for every image (keyframes + `screenshot.png`) and the recording

For each piece of media you're attaching:

1. `prepare_attachment_upload(issue=<id>, filename=<name>, contentType=<mime>, size=<bytes>)` — capture `uploadRequest` and `assetUrl`.
2. PUT the raw bytes to `uploadRequest.url` with the returned headers verbatim. Use `curl --data-binary @<path>` or equivalent; do NOT base64-encode or transform the bytes.
3. `create_attachment_from_upload(issue=<id>, assetUrl=<assetUrl>, title=<short caption>)` — capture the returned `url`.
4. Embed inline as `![caption](url)` using the bare URL.

Create the issue FIRST with a placeholder Evidence section like `_uploading…_`. Then run the prepare → PUT → finalize chain for every attachment **in parallel** — they don't depend on each other once the issue exists. Finally one `save_issue` (with `id`) to swap the placeholder for the real inline markdown.

**The user's screenshot.** If `brief.json.hasScreenshot` is true, embed `screenshot.png` inline in Evidence — it's often the single most important image. If `screenshotAnnotated`, caption it to point at the red, e.g. `![The red circle marks the nav label that should be plural](url)`. For a screenshot-only brief, this is your primary (often only) evidence image.

### Attach the recording? (decision)

A recording exists ONLY if `brief.json` has a `recording` field (and `recording.webm` is on disk). Screenshot-only and text-only briefs have none — skip this whole sub-section for them.

#### Rule 0 — the explicit override (check this FIRST, before anything else)

**If the merged `brief.json` from Step 0 has `includeVideo: true`, attach the recording. Full stop.**

- This is a hard rule. No judgment, no weighing, no "but the bug looks static". The user opened the popup, ticked the "Attach the recording to the ticket" checkbox on that brief, and exported. They asked.
- Skipping it in this case is a bug in your run, not a discretionary call.
- Narrate: **`User asked to attach the recording — attaching.`** so it's visible in the progress log.
- Do NOT continue reading the heuristics below for this brief. They don't apply when the explicit flag is set.

If `includeVideo` is not `true` (false / missing / no companion zip), continue to Rule 1.

#### Rule 1 — your judgment (only when no explicit override)

**Attach it only when the video genuinely beats the keyframes** — don't attach by default, and don't attach just because it exists.

Attach the recording when:
- The bug is about **motion or timing**: jank, flash, race, layout jump, scroll glitch, broken transition.
- The repro is a **multi-step interaction** hard to convey with stills (drag-and-drop, multi-field form flow, hover/focus sequence).
- The keyframes **miss the moment** — sampling didn't capture the exact failure frame.
- The user's voice references something dynamic ("watch how it stutters when I click").

Skip the recording (keyframes alone are enough) when:
- It's a **static** bug — wrong text, broken layout, missing button, bad color. A screenshot says everything.
- The keyframes already show the before/after clearly.
- It's a **feature request** without an on-screen repro.

#### When attaching (Rule 0 or Rule 1)

Use the same upload procedure above with `contentType='video/webm'`, then embed inline:

```markdown
**Recording**

![Recording](<url>)
```

Linear renders an inline player from a video URL. Place the Recording section right after Evidence (bugs) or Notes (features). Don't also write a separate "see attached" line — the inline player is enough.

## 9. Clean up and report — solo ticket only

> **Inbox mode:** if this ticket is being filed as part of an inbox batch, **stop here**. Don't delete anything and don't post a closing summary — `inbox.md` handles cleanup (Step 5) and the single closing summary (Step 6) for the whole batch. Just return control with the ticket URL captured.

### 9a. Delete the brief (solo only)

Narrate: **`Deleting source brief…`**

After the ticket is successfully filed, delete the source brief from disk:

```bash
rm -rf ~/Downloads/brief/brief-<id>.zip
rm -rf ~/Downloads/brief/brief-<id>-extra.zip
rm -rf ~/Downloads/brief/brief-<id>/
```

The user does NOT want old briefs accumulating in their Downloads folder — the ticket is the permanent artifact now, the brief was just the input. **Only delete if the ticket filing was confirmed successful.** If anything went wrong (MCP error, network failure, ambiguous request), leave the brief in place and tell the user what failed so they can retry.

### 9b. Closing summary (solo only) — celebratory + actionable

End with one short message. The ticket title is a markdown hyperlink to the URL, so the user can click it directly. One emoji at the start to mark the celebration — exactly one, no parade. End with a soft, single-line offer to tweak — never a question that gates anything.

Template:

> 🎉 Filed in **<team>** — [<ticket title>](<url>)
>
> Anything to tweak? Status, priority, labels, assignee, or team — just say.

If guidance from the user's settings applied something they should know about (e.g. you set `state: Backlog`, `priority: Medium`, `labels: ['inbound']`), add one quiet line just above the offer:

> Applied your defaults: Backlog · Medium · `inbound`.

If you had to deviate from the guidance (e.g. a label they listed doesn't exist in the team's label set), say so neutrally on its own line:

> Couldn't apply `inbound` — that label doesn't exist in **<team>**.

That's it. No mid-flow questions. No "do you want me to attach the video?". You decided, you executed, you reported.
