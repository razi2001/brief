---
name: brief
description: Use this skill whenever the user mentions a "brief" (e.g. "turn brief mpogywhs-ft15hr into a ticket", "process my inbox: briefs X, Y, Z"). Briefs are captured with the Brief Chrome extension and stored locally on disk. A brief may contain a screen+voice recording, an annotated screenshot, a text description, or any combination. This skill routes single briefs through ticket.md and batches through inbox.md, files real tickets via the user's connected tracker MCP, and then deletes the processed brief.
---

# Brief — Router

Briefs are captured locally and stored in `~/Downloads/brief/`. Each is either:

- a `.zip` file (`brief-<id>.zip`) — yet-to-be-extracted
- a folder (`brief-<id>/`) after extraction

**A brief can contain any combination of these** (check `brief.json` to see which):

- **A recording** — `recording.webm` + sampled `keyframes/*.png` + a voice `transcript`. (Recording briefs.)
- **An annotated screenshot** — `screenshot.png`. **Any red markings on it were drawn by the user to point at where the issue is.** Treat the red as the focus indicator, not as part of the page UI. (`brief.json.hasScreenshot` / `screenshotAnnotated`.)
- **A text description** — `brief.json.description`, the user's own words about the issue.

So a brief might be a full recording, OR just a screenshot with a red circle, OR just a sentence of text, OR a mix. Use whatever is present. Never assume a recording exists — read `brief.json` first.

Briefs only exist for one purpose: to become Linear/Jira/GitHub/Notion tickets. Your job is to file the ticket — efficiently, without unnecessary questions — and then clean up.

## Step 1 — Identify the action

The user's prompt will be one sentence containing one of:

| User says…                                | Load                     |
|-------------------------------------------|--------------------------|
| "process my inbox" / "briefs X, Y, Z"     | `playbooks/inbox.md`     |
| "turn brief X into a ticket" (or similar) | `playbooks/ticket.md`   |

If the prompt names multiple brief IDs or contains the word "inbox", use `inbox.md` — that playbook orchestrates the others. Otherwise use `ticket.md`.

## Step 2 — Read the playbook

The playbooks live next to this file, in the same `skill/playbooks/` folder inside the brief. Load the matching one (`skill/playbooks/<name>.md`) and follow it. It contains all the rules: how to read the brief files, how to handle screenshots/recordings/text, how to infer the team/repo, how to embed images inline, etc.

## Hard rules (apply across all playbooks)

1. **Never ask the user anything mid-flow.** No "should I proceed?", no "which team?", no "do you want me to attach the recording?". Infer team / repo / channel from the page URL, the user's connected MCPs, recent activity. Decide every other judgment call yourself. State your inferences in the final summary so the user can correct next time if wrong. The closing summary may end with a single soft offer ("anything to tweak?") — that's an invitation for follow-up, not a confirmation gate. Never put a question anywhere except that final line.
2. **Binary-search keyframes** — read 3-5 strategic frames (first, midpoint, last; more only if needed), not all of them. Most briefs have 20+ keyframes; reading all is wasteful.
3. **Embed images INLINE** via markdown `![](attachmentUrl)`, not as bare attachments. The ticket should be readable end-to-end without clicking through to attachments.
4. **Map transcript chunks to keyframes** by timestamp (±2000ms). When the user said something, what was on screen?
5. **Treat the transcript as a draft.** Chrome's speech recognition is mediocre on accents and jargon. Use the keyframes and page context as ground truth; silently correct obvious mis-transcriptions.
6. **Narrate each step in one short line as you do it.** The user wants to watch progress, not be left in silence. Before each tool call or phase write one declarative sentence — `Listing briefs…`, `Reading brief.json for mpogywhs…`, `Inferring team from app.acme.com/billing → Billing.`, `Uploading 3 keyframes in parallel…`, `Creating ticket…`, `Done.`. Statements, never questions. Don't dump tool output; one line of intent per action.
7. **The ticket must read like a teammate wrote it from scratch.** It describes the bug or feature and shows evidence. Nothing else.

   Banned vocabulary — never appears anywhere in the title, description, captions, or image alt text:
   - `brief`, `the brief`, `briefs`, `Brief extension`, brief IDs (e.g. `mpztxhn5-…`)
   - `recording`, `recorded`, `screen recording`, `captured`, `capture` (the noun form referring to the tool)
   - `transcript`, `voice`, `narrated`, `said`, `mentioned`, `the user said`, `the user wants`, `the reporter`
   - `keyframe`, `Frame at 0:02`, any `mm:ss` timestamp tied to media
   - Paths like `~/Downloads/brief/…`, file names like `brief.json` / `recording.webm` / `keyframe-002.png`
   - Phrases like "in the recording", "as shown in the video", "according to the transcript"

   The single allowed reference to media is the inline embed itself — a markdown image or `![Recording](...)` block. The section is just called **Evidence** or **Recording**, never "Recorded evidence" or "Captured frames".

   **Captions describe what's in the image, not what was said about it.** Not `Frame at 0:02 — checkout page before click`, just `Checkout page before clicking Pay`. The transcript informs your wording; it never appears as a quote in the ticket.

## Step 3 — Delete the brief after processing

**Critical:** once a brief has been successfully turned into a real ticket (or batch of tickets), delete the source brief.

For a single brief:
- Delete both the zip (`~/Downloads/brief/brief-<id>.zip`) and any extracted folder (`~/Downloads/brief/brief-<id>/`)

For an inbox batch:
- Delete each brief in the batch as it's successfully processed
- If one brief fails, leave that one and continue with the rest
- Report at the end which were deleted vs. which were left for retry

The user does NOT want a directory full of old briefs accumulating. Briefs are ephemeral capture; tickets are the permanent artifact.

**Only delete on success.** If you couldn't file the ticket (MCP error, ambiguous request, anything), leave the brief in place so the user can retry. Tell them why it failed.
