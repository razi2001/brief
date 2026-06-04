# Playbook — Inbox (batched ticket filing)

The user is processing multiple briefs at once. Their prompt is one of:

> Use the brief skill to process my inbox: briefs abc-123, def-456, xyz-789.

…or, with no IDs listed:

> Use the brief skill to process my inbox.

Both mean the same thing: file tickets for everything currently in `~/Downloads/brief/`, group obvious duplicates, clean up the folder when done.

**Narrate the run as you go.** One short declarative line before each phase or significant tool call. Never ask the user anything mid-run — decide and act. The user is watching progress, not being interviewed.

## Step 1 — Discover briefs

Narrate: **`Listing inbox…`**

If the user named brief IDs in the prompt, use that list.

Otherwise, **list everything** in `~/Downloads/brief/`:

```bash
ls ~/Downloads/brief/
```

Pick up every `brief-<id>.zip` and every extracted `brief-<id>/` folder. If both exist for the same id, use the folder (already extracted). Build the list yourself.

Narrate the count: **`Found N briefs.`**

For each brief:
1. Extract the zip if it isn't already extracted
2. Read `brief.json`
3. Note `id`, `pageUrl`, `pageTitle`, `transcript`, `transcriptChunks`, `keyframeMeta`, `events`, `description`, `hasScreenshot`, `extra`, `recording`

Don't read keyframes yet — just metadata.

If you see a `guidance.txt` file alongside the briefs, ignore it for now — it's not a brief. `ticket.md` reads it per ticket as part of its "Apply user guidance" step.

If the inbox is empty (no briefs found), say so briefly and stop: *"Inbox is empty — nothing to process."* Don't error out.

## Step 2 — Triage silently, then announce the plan

Decide silently for every brief: bug vs. feature, target team, which briefs to dedupe into one ticket (see Step 3 for grouping signals).

**Then announce the plan in one declarative line — no question, no waiting.** Example:

> Plan: 6 tickets — 5 bugs, 1 feature. Deduping 2 briefs on the Labels date picker into one. Filing now.

That's it. Move straight into Step 4. The user can interject in their next message if something's wrong; don't pause for confirmation.

**Never write "Proceed?", "Should I…?", or "Let me know if…".** Statements only.

## Step 3 — Group related briefs

Look for pairs/triples that should be one ticket. Signals:

- **Same page URL + overlapping topic** → almost certainly the same issue reported twice.
- **Same error message in `console-error` events** → same bug.
- **One report explicitly references another** ("like the thing I just sent you") → linked, file both but cross-link in your internal triage.

When grouping, the resulting ticket should:
- Have ONE title that covers the combined issue.
- Embed evidence from every contributing source — but captions are still neutral. Never write "from brief abc-123", never label frames by source. The ticket reads as one investigation, not a stitched-together report.
- Track the source brief ids ONLY in your own internal notes for cleanup (Step 5). They do NOT appear in the ticket body, title, or captions. (The hard rule in SKILL.md is absolute on this.)

## Step 1b — Honor a named subset

The prompt from the extension names the exact set of briefs to process. The shape is intentionally minimal:

> Process briefs from ~/Downloads/brief/: a1b2c3 ("Checkout button dead"), d4e5f6 ("Logo too big"). Unzip brief-a1b2c3.zip and follow its skill/SKILL.md.

Per brief:
- `<id>` — always present.
- `("<name>")` — optional user-given quick name. Treat as a strong title hint when present; absent is fine, derive the title from `brief.json` (`description`, `transcript`) instead.

**Everything else lives on disk, not in the prompt.** Content type, full description, `extra` k/v pairs, and the user's per-brief "attach recording" toggle (`includeVideo: true` in a companion `brief-<id>-extra.zip`'s `brief.json`) are all in the brief itself — `ticket.md` Step 0 reads and merges them. The prompt does not duplicate them.

When the prompt names a subset:
- **Process only those briefs.** Ignore any other files in the folder — the user may have other briefs in progress that they haven't exported yet.
- **Process those briefs**, then clear the whole folder at the end (see Step 5). The export hands off the user's full set, so once they're all filed nothing should remain.

If the prompt does NOT name a subset (just "process my inbox"), process everything in the folder.

## Step 4 — Process each ticket

For each item in your processed list (single brief or grouped briefs), follow `playbooks/ticket.md` — same rules apply (binary-search keyframes, inline images, no questions to the user, etc.).

Narrate each one as you start: **`Filing K/N — <short title>…`**

The only adjustment vs. solo ticket filing: be **concise** in the description. The user is processing several things at once; they're not going to read each ticket in detail. Lead with what's broken, then evidence, then technical notes — skip the speculation.

**Do not delete briefs as you go.** Hold off on cleanup until every ticket in the batch has been attempted (Step 5).

## Step 5 — Clean up the folder

Once every ticket has been attempted, decide cleanup based on the outcome:

**All tickets filed successfully** → wipe the folder clean:

```bash
rm -rf ~/Downloads/brief/*
```

Narrate: **`Cleared inbox.`**

The wipe includes `guidance.txt` — intentional. It's regenerated from the extension's settings on every export.

**Any ticket failed** → leave the folder alone. Don't try to surgically delete only the successful ones; keep the inbox intact as a clean recovery point. Narrate: **`Inbox left intact — N succeeded, M failed (see summary).`**

Never destroy a brief that never became a ticket.

## Step 6 — Single closing summary — celebratory + actionable

After cleanup, give one final message. **Each ticket appears as a markdown hyperlink** (title is the link text, the tracker's returned URL is the target) — that's what makes the title clickable in Linear/Slack/Notion/etc. instead of a raw URL dangling on its own line. One celebration emoji on the header, no parade. End with a single soft offer for adjustments — never a gating question.

**All tickets in one team:**

> 🎉 Filed **N** tickets in **Billing**:
> - [Date picker broken on Labels page](https://linear.app/acme/issue/LIN-1234)
> - [Test plan export missing CSV option](https://linear.app/acme/issue/LIN-1235)
> - [Add bulk delete to test cases](https://linear.app/acme/issue/LIN-1236)
> - [Customer impersonation should warn on save](https://linear.app/acme/issue/LIN-1237)
>
> Anything to tweak? Just say which ticket and what to change.

**Tickets across multiple teams** — drop the team from the header, suffix each line:

> 🎉 Filed **N** tickets:
> - [Date picker broken on Labels page](https://linear.app/acme/issue/LIN-1234) — *Billing*
> - [Test plan export missing CSV option](https://linear.app/acme/issue/LIN-1235) — *Platform*
>
> Anything to tweak? Just say which ticket and what to change.

If guidance from the user's settings applied something across the batch (e.g. you set every ticket to `Backlog` with priority `Medium`), add one quiet line just above the offer:

> Applied your defaults to all: Backlog · Medium · `inbound`.

If you had to deviate from the guidance for one or more tickets (e.g. a label they listed doesn't exist in a target team), name them on their own line below the list:

> Couldn't apply `inbound` to the **Platform** ticket — that label doesn't exist there.

If anything failed, add a **Retained for retry** section at the bottom listing each retained brief with one line of why (e.g. `pqr-678 — Linear save_issue returned 500`). Don't put brief ids in the ticket body itself — those go only in this summary.

Use the actual ticket URLs returned by the tracker, not constructed identifiers. The user clicks them.

## What NOT to do

- **Don't ask the user anything mid-run.** Decide and act. The closing summary is where they can correct you.
- **Don't narrate by dumping tool output.** One short declarative sentence per phase or significant tool call.
- **Don't try to be clever about ordering.** File in the order the user mentioned them (or, for "process my inbox", alphabetical by brief id).
- **Don't delete a brief if its ticket-filing failed.** That brief is the user's only record of what they wanted to capture.
- **Don't delete briefs one-by-one as tickets file.** Wait until the whole batch is done, then do one cleanup decision (Step 5).

## Edge case — missing brief

If a brief zip referenced in the prompt isn't on disk, mention it in the announce-plan line and skip it — don't pause:

> Plan: 6 tickets — 1 brief (xyz-789) not found on disk, skipping it. Filing now.

The missing brief shows up under **Retained for retry** in the closing summary.
