---
name: brief
description: Use this skill whenever the user mentions a "brief" (e.g. "turn brief mpogywhs-ft15hr into a ticket", "process my inbox: briefs X, Y, Z"). Briefs are captured with the Brief Chrome extension and stored locally on disk. A brief may contain a screen+voice recording, an annotated screenshot, a text description, or any combination. This skill routes single briefs through ticket.md and batches through inbox.md, files real tickets via the user's connected tracker MCP, and then deletes the processed brief.
---

# Brief — Router

Briefs are captured locally and stored in `~/Downloads/brief/`. Each brief lives in its own folder, `~/Downloads/brief/brief-<id>/`, which contains:

- `brief-<id>.zip` — the main payload (unzip it to read `brief.json`, `recording.webm`, `keyframes/`, etc.)
- optionally `brief-<id>-extra.zip` — a companion zip with a screenshot and/or description the user added after recording. Always unzip this too when present.

Everything for one brief stays in that one folder — including whatever the zips extract into.

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

0. **Always unzip the companion `-extra.zip` if it exists in the brief's folder.** The export prompt is intentionally minimal and won't list it. The companion is where post-record edits live (description, screenshot, additional data, the `attachRecording` flag); its fields override the main `brief.json` on conflict. **Any red markings in a screenshot were drawn by the user to point at where the issue is** — treat them as the focus indicator, not part of the page UI.
0a. **Process multiple briefs in parallel via sub-agents — MANDATORY.** Whenever the prompt names more than one brief (or `inbox.md` discovers more than one), spawn one sub-agent per ticket (one per group, for grouped tickets) and dispatch them all in a **single assistant message** with parallel Task/Agent tool calls. Same message = concurrent; across messages = serial. Each brief is independent (separate folder, separate tracker write, no shared state) so there is no reason to process them serially, and "processing them inline yourself one after another" is the anti-pattern this rule exists to prevent. `inbox.md` Step 4 has the full anti-pattern list — read it before you start.

0b. **No "Proceed?" gates on Export.** When the prompt arrived via the extension's Export button, the user has already chosen which briefs to file — that IS the go-ahead. Announce the plan in one line and dispatch immediately; do not ask "Ready to file these?" or wait for a yes. Only stop to ask when a specific brief is genuinely un-fileable (no inferable team, unparseable content) — flag that one, file the rest.
1. **Never ask which team / repo / channel.** Infer from the page URL, the user's connected MCPs, recent activity. State your inference in the final summary so the user can correct next time if wrong.
2. **Binary-search keyframes** — read 3-5 strategic frames (first, midpoint, last; more only if needed), not all of them. Most briefs have 20+ keyframes; reading all is wasteful.
3. **Embed images INLINE** via markdown `![](attachmentUrl)`, not as bare attachments. The ticket should be readable end-to-end without clicking through to attachments.
4. **Map transcript chunks to keyframes** by timestamp (±2000ms). When the user said something, what was on screen?
5. **Treat the transcript as a draft.** Chrome's speech recognition is mediocre on accents and jargon. Use the keyframes and page context as ground truth; silently correct obvious mis-transcriptions.
6. **One closing summary, not running commentary.** Don't narrate each step. When you're done, post one message: "Filed LIN-1234 — <title>." That's it.
7. **The ticket must read like a human wrote it.** Never mention "brief", "the brief", the Brief extension, recordings-as-source, file paths under `~/Downloads/brief/`, or how the report was captured. The ticket describes the bug/feature and shows evidence — nothing about the tooling that produced it. (The recording, if attached, is just "Recording" — not "the brief's recording".)

## Step 3 — Delete the brief after processing

**Critical:** once a brief has been successfully turned into a real ticket (or batch of tickets), delete the source brief — the entire per-brief folder, not just one zip inside it.

For a single brief:
- Delete the whole folder: `~/Downloads/brief/brief-<id>/` — this removes the main zip, the companion `-extra.zip`, and any extracted contents in one shot.

For an inbox batch:
- After each brief's ticket is confirmed filed, delete that brief's folder (`~/Downloads/brief/brief-<id>/`). This way a partial failure leaves only the failed brief on disk for retry, not all of them.
- When every brief in the batch has been filed successfully, **delete the whole `~/Downloads/brief/` folder** — one command, not a wildcard. The extension recreates it on the next download.
- If one brief fails, leave its folder in place and don't run the full-folder delete — only the per-brief deletes that already happened for the successes stand.
- Report at the end which were deleted vs. which were left for retry.

**Windows deletion gotcha — Mark-of-the-Web.** Chrome attaches an NTFS read-only attribute to downloaded files. On native Windows you need `Remove-Item -Recurse -Force` (the `-Force` strips it). If you're running in WSL or a Linux container against a mounted Windows Downloads folder, plain `rm -rf` will fail with "Operation not permitted" because Linux can't strip NTFS-level attributes — shell out to PowerShell via interop: `powershell.exe -Command "Remove-Item -Recurse -Force ..."`. Each playbook has the exact commands.

The user does NOT want a directory full of old briefs accumulating. Briefs are ephemeral capture; tickets are the permanent artifact.

**Only delete on success.** If you couldn't file the ticket (MCP error, ambiguous request, anything), leave the brief's folder in place so the user can retry. Tell them why it failed.
