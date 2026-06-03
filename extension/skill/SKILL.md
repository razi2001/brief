---
name: brief
description: Use this skill whenever the user mentions a "brief" (e.g. "turn brief mpogywhs-ft15hr into a ticket", "process my inbox: briefs X, Y, Z"). Briefs are captured with the Brief Chrome extension and stored locally on disk. A brief may contain a screen+voice recording, an annotated screenshot, a text description, or any combination. This skill routes single briefs through ticket.md and batches through inbox.md, files real tickets via the user's connected tracker MCP, and then deletes the processed brief.
---

# Brief — Router

Briefs are captured locally and stored in `~/Downloads/brief/`. Each brief lives in its own folder, `~/Downloads/brief/brief-<id>/`, which contains:

- `brief-<id>.zip` — the main payload (unzip in place to read `brief.json`, `recording.webm`, `keyframes/`, etc.)
- optionally `brief-<id>-extra.zip` — a companion zip with state the user added *after* the recording was saved (screenshot, description, additional data, and an `attachRecording` flag). Always unzip this too when present; its fields override the main `brief.json`.

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

0. **Always unzip the companion `-extra.zip` if it exists in the brief's folder.** The prompt won't name it. The companion holds anything the user added after recording (description, screenshot, additional data, the `attachRecording` flag) — its fields override the main `brief.json` on conflict. **Any red markings in a screenshot were drawn by the user to point at where the issue is** — treat them as the focus indicator, not part of the page UI.
0a. **Parallel sub-agents for multi-brief batches — MANDATORY.** Whenever there are 2 or more tickets to file, dispatch one sub-agent per ticket via parallel Task/Agent tool calls **in a single assistant message**. Same message = concurrent; across messages = serial. Each ticket is independent (separate folder, separate tracker write, no shared state) so there is no reason to process them inline one after another. Speed is the whole point. The lone exception: a single ticket after deduping → handle it inline.
1. **Never ask which team / repo / channel.** Infer from the page URL, the user's connected MCPs, recent activity. State your inference in the final summary so the user can correct next time if wrong.
2. **Binary-search keyframes** — read 3-5 strategic frames (first, midpoint, last; more only if needed), not all of them. Most briefs have 20+ keyframes; reading all is wasteful.
3. **Embed images INLINE** via markdown `![](attachmentUrl)`, not as bare attachments. The ticket should be readable end-to-end without clicking through to attachments.
4. **Map transcript chunks to keyframes** by timestamp (±2000ms). When the user said something, what was on screen?
5. **Treat the transcript as a draft.** Chrome's speech recognition is mediocre on accents and jargon. Use the keyframes and page context as ground truth; silently correct obvious mis-transcriptions.
6. **One closing summary, not running commentary.** Don't narrate each step. When you're done, post one message: "Filed LIN-1234 — <title>." That's it.
7. **The ticket must read like a human wrote it.** Never mention "brief", "the brief", the Brief extension, recordings-as-source, file paths under `~/Downloads/brief/`, or how the report was captured. The ticket describes the bug/feature and shows evidence — nothing about the tooling that produced it. (The recording, if attached, is just "Recording" — not "the brief's recording".)

## Step 3 — Delete the brief after processing

**Critical:** once a brief has been successfully turned into a real ticket (or batch of tickets), delete the source brief — the whole per-brief folder, not just one zip inside it.

For a single brief:
- Delete the folder `~/Downloads/brief/brief-<id>/` — this removes the main zip, the companion `-extra.zip`, and any extracted contents in one shot.

For an inbox batch:
- After each brief's ticket is confirmed filed, delete that brief's folder (`~/Downloads/brief/brief-<id>/`). Per-brief deletes during the batch mean a partial failure leaves only the failed brief on disk, not all of them.
- When every brief in the batch has been filed successfully, delete the whole `~/Downloads/brief/` folder. The extension recreates it on the next download.
- If any brief fails, leave its folder in place and skip the whole-folder wipe.
- Report at the end which were deleted vs. which were left for retry.

The user does NOT want a directory full of old briefs accumulating. Briefs are ephemeral capture; tickets are the permanent artifact.

**Only delete on success.** If you couldn't file the ticket (MCP error, ambiguous request, anything), leave the brief in place so the user can retry. Tell them why it failed.

**Cross-platform delete — important on Windows.** Chrome attaches a Mark-of-the-Web read-only attribute to downloaded files. Plain `rm -rf` fails against that, even from WSL or a Linux container reading the Windows volume (the Linux kernel sees the attribute but isn't allowed to clear it). Use the right form for your environment — each playbook has the exact commands:

| Environment | Form |
|---|---|
| macOS / Linux | `rm -rf ~/Downloads/brief/brief-<id>/` |
| Native Windows (PowerShell) | `Remove-Item -Recurse -Force "$env:USERPROFILE\Downloads\brief\brief-<id>"` |
| WSL / Linux on a Windows volume | `powershell.exe -Command "Remove-Item -Recurse -Force \"\$env:USERPROFILE\Downloads\brief\brief-<id>\""` |
