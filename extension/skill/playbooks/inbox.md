# Playbook — Inbox (batched ticket filing)

The user is processing multiple briefs at once. Their prompt is one of:

> Use the brief skill to process my inbox: briefs abc-123, def-456, xyz-789.

…or, with no IDs listed:

> Use the brief skill to process my inbox.

Both mean the same thing: file tickets for everything currently in `~/Downloads/brief/`, group obvious duplicates, delete each brief after success.

## Step 1 — Discover briefs

If the user named brief IDs in the prompt, use that list.

Otherwise, **list the per-brief folders** under `~/Downloads/brief/`:

```bash
ls ~/Downloads/brief/
```

Each brief is a folder `brief-<id>/` containing `brief-<id>.zip` and optionally `brief-<id>-extra.zip`. Build the list yourself.

For each brief folder:
1. Unzip `brief-<id>.zip` into the folder if not already extracted
2. If `brief-<id>-extra.zip` is present, unzip it too (into the same folder) — it carries a screenshot and/or description the user added after recording
3. Read `brief.json` (the main one; merge the extra one's `description`/`screenshot.png` into your understanding)
4. Note `id`, `pageUrl`, `pageTitle`, `transcript`, `transcriptChunks`, `keyframeMeta`, `events`

Don't read keyframes yet — just metadata.

If the inbox is empty (no briefs found), say so briefly and stop: *"Inbox is empty — nothing to process."* Don't error out.

## Step 2 — Triage out loud

**Announce the plan in one line, then proceed immediately. Do NOT ask "Proceed?" or "Ready to file these?" — the user already clicked Export; that IS the go-ahead.**

A single short message like this is enough; the very next thing you do is dispatch the sub-agents in Step 4:

> Filing 7 briefs (5 bugs, 2 features). Deduping 2 about the date picker into one ticket. Dispatching 6 sub-agents now.

Then keep moving. The user can interrupt if anything in that line looks wrong; they don't need to type "yes" for you to start. The only time to pause for confirmation is if a brief is genuinely ambiguous (you can't tell what tracker / what team / can't classify it) — flag that one specifically and file the others without waiting.

Why no checkpoint? Export already is the checkpoint. The user reviewed their list in the popup, decided which briefs were ready, and pressed the button. Treating Export as "draft for review" instead of "file these" defeats the whole point of the inbox flow.

## Step 3 — Group related briefs

Look for pairs/triples that should be one ticket. Signals:

- **Same page URL + overlapping transcript topic** → almost certainly the same issue captured twice
- **Same error message in `console-error` events** → same bug
- **One brief explicitly references another** (the user said "like the thing I just recorded") → linked, file both but cross-link

When grouping, the resulting ticket should:
- Have ONE title (best phrasing from across the briefs)
- Embed keyframes from ALL contributing briefs (clearly labeled "from brief abc-123" etc.)
- Concatenate the transcripts with brief-id markers
- List all source brief IDs in the description for traceability

## Step 1b — Honor a named subset

The prompt from the extension names the exact set of briefs to process, each with a user-given name, e.g.:

> Process these briefs from ~/Downloads/brief/: a1b2c3 ("Checkout button dead"), d4e5f6 ("Logo too big"). Each brief lives in its own folder (~/Downloads/brief/brief-<id>/). Start with ~/Downloads/brief/brief-a1b2c3/brief-a1b2c3.zip — unzip it and follow its skill/SKILL.md.

(The prompt no longer carries a "parallelize" hint — that rule lives in this skill, Hard Rule 0a and Step 4 below. Apply it whether or not the prompt mentions it.)

The prompt is intentionally short — it only tells you *where* to look and *which* briefs the user kept. The rules below are yours to apply. When the prompt names a subset:
- **Process only those briefs.** Ignore any other files in the folder — the user may have other briefs in progress that they haven't exported yet.
- **Use the given names** as a strong hint for each ticket's title (the user already told you what each one is about). The transcript and keyframes still provide the detail; the name anchors the intent.
- **Process those briefs**, then clear the whole folder at the end (see Step 5). The export hands off the user's full set, so once they're all filed nothing should remain.

If the prompt does NOT name a subset (just "process my inbox"), process everything in the folder and delete each brief as you file it.

## Step 4 — Dispatch sub-agents (MANDATORY)

**If there are 2 or more tickets to file, you MUST spawn one sub-agent per ticket and run them in parallel.** This is not a suggestion, not an optimization, not "if you feel like it" — it is the only correct way to process the batch. One sub-agent per ticket, dispatched in a single batch of parallel tool calls, all running concurrently.

**How to do it (Claude Code / similar harness):** make multiple `Task` / `Agent` tool calls **in a single assistant message**. That is what makes them run concurrently. Calling them across separate messages serializes them and defeats the entire point. In one message, fan out N tool calls — N = number of tickets after deduping.

**Each sub-agent owns exactly one ticket's worth of work.** Hand it the absolute path(s) to the brief folder(s) and tell it to follow `playbooks/ticket.md` end-to-end: read `brief.json` + companion, pick the team, upload attachments, call `save_issue`, fill metadata per Step 6b, and delete that brief's folder on success. It returns the filed ticket's URL + a one-line summary. Nothing else.

**Why this is required, not optional:**

- Tickets are genuinely independent: separate folders, separate tracker writes, no shared state. Serial processing wastes wall-clock for zero benefit.
- Attachment uploads (keyframes + recording) are network-heavy. Concurrency hides that latency.
- The main agent's context stays clean — it sees N short "Filed LIN-1234" summaries instead of N full upload transcripts.

**Anti-patterns — do not do these:**

| Anti-pattern | Why it's wrong |
|---|---|
| Process each brief inline yourself, one after another | Serial — exactly what sub-agents are for. If your message reads "Now processing brief 1… now brief 2…", you're doing it wrong. |
| Spawn sub-agents across separate assistant messages | Sequential. Concurrency only happens when multiple Task/Agent calls are in the **same** message. |
| Spawn one sub-agent for "the whole batch" | Defeats parallelism — that sub-agent will itself process serially. One per ticket. |
| Skip sub-agents because there are "only 2 or 3 briefs" | Threshold is 2, not 5. Two tickets → two sub-agents, in parallel. |
| Spawn sub-agents, then wait between rounds to spawn the next batch | Fan out **all** of them at once. The harness handles the actual concurrency cap. |

**The one exception — a single ticket:** if, after deduping, there is exactly one ticket to file, do it inline yourself. No point spawning a sub-agent for one item.

**Grouped tickets** (multiple source briefs combining into one ticket): still one sub-agent for that group — it owns all N source folders and deletes them all on success.

Whatever the sub-agent does, it still follows `playbooks/ticket.md` exactly — same rules (binary-search keyframes, inline images, no clarifying questions about team, fill metadata per Step 6b, file in a good state matching team conventions).

**Concision for batches.** The user is processing several things at once; they won't read each ticket in detail. Each sub-agent leads its description with what's broken, then evidence, then technical notes — skip the speculation.

Each filed ticket still has to be in a **good state** — state/priority/labels/cycle filled to match the team's convention (see `ticket.md` step 6b). Batch processing is no excuse for bare title-plus-description tickets.

## Step 5 — Delete filed briefs, then clear the folder

As each ticket is successfully filed, delete that brief's entire folder — that removes the main zip, the companion `-extra.zip`, and any extracted contents in one shot. Pick the form for your environment:

```bash
# macOS / Linux
rm -rf ~/Downloads/brief/brief-<id>/
```

```powershell
# Native Windows (PowerShell)
Remove-Item -Recurse -Force "$env:USERPROFILE\Downloads\brief\brief-<id>"
```

```bash
# WSL / Linux container reading a Windows Downloads folder
# rm -rf alone can't clear Chrome's NTFS Mark-of-the-Web; shell out to PowerShell:
powershell.exe -Command "Remove-Item -Recurse -Force \"\$env:USERPROFILE\Downloads\brief\brief-<id>\""
```

For a grouped ticket that combined multiple briefs, delete ALL the source brief folders in the group once the ticket is confirmed filed.

**End-of-run cleanup.** Once every brief in the batch has been filed successfully, wipe everything under `~/Downloads/brief/`:

```bash
# macOS / Linux
rm -rf ~/Downloads/brief/*
```

```powershell
# Native Windows
Remove-Item -Recurse -Force "$env:USERPROFILE\Downloads\brief\*"
```

```bash
# WSL / Linux on a Windows volume
powershell.exe -Command "Remove-Item -Recurse -Force \"\$env:USERPROFILE\Downloads\brief\*\""
```

**Only do the full wipe if every brief filed successfully.** If any ticket failed (MCP error, ambiguous request), do NOT wipe — leave the folder as-is, keep the brief(s) that failed, and report what failed so the user can retry. Never destroy a brief that never became a ticket.

## Step 6 — Single closing summary

After all briefs are processed, give one final message:

> Done. Filed:
> - LIN-1234 — Date picker broken on Labels page *(from briefs abc-123, def-456 — both deleted)*
> - LIN-1235 — Test plan export missing CSV option *(from brief ghi-789 — deleted)*
> - LIN-1236 — Add bulk delete to test cases *(from brief jkl-012 — deleted)*
> - LIN-1237 — Customer impersonation should warn on save *(from brief mno-345 — deleted)*
>
> **Skipped** (brief retained for retry):
> - brief pqr-678 — couldn't infer team from the page URL; please retry with the team in the prompt

Concise. One line per output. Each line says what was filed AND whether the brief was cleaned up. The user should be able to verify everything that happened in 10 seconds.

## What NOT to do

- **Don't process briefs serially without the triage step.** Even with only 2 briefs, do the summary first — it's the user's checkpoint.
- **Don't auto-skip briefs you don't understand.** If a brief is ambiguous, flag it in the triage summary and ask. Better to ask once than to file a wrong ticket.
- **Don't try to be clever about ordering.** File in the order the user mentioned them.
- **Don't delete a brief if its ticket-filing failed.** That brief is the user's only record of what they wanted to capture.

## Edge case — missing brief

If a brief zip referenced in the prompt isn't on disk, note it in the triage step and proceed without it:

> One brief (xyz-789) wasn't found in ~/Downloads/brief/. It may have been moved or already processed. Skipping it. The other 6 are ready — proceed?
