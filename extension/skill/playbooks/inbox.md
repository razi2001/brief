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

If the inbox is empty (no briefs found), say so briefly and stop: *"Inbox is empty — nothing to process."* Don't error out.

## Step 2 — Triage silently, then announce the plan

Decide silently for every brief: bug vs. feature, target team, which briefs to dedupe into one ticket (see Step 3 for grouping signals).

**Then announce the plan in one declarative line — no question, no waiting.** Example:

> Plan: 6 tickets — 5 bugs, 1 feature. Deduping 2 briefs on the Labels date picker into one. Filing now.

That's it. Move straight into Step 4. The user can interject in their next message if something's wrong; don't pause for confirmation.

**Never write "Proceed?", "Should I…?", or "Let me know if…".** Statements only.

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

The prompt from the extension names the exact set of briefs to process. The shape is intentionally minimal:

> Process briefs from ~/Downloads/brief/: a1b2c3 ("Checkout button dead") [+recording], d4e5f6 ("Logo too big"). Unzip brief-a1b2c3.zip and follow its skill/SKILL.md.

Per brief:
- `<id>` — always present.
- `("<name>")` — optional user-given quick name. Treat as a strong title hint when present; absent is fine, derive the title from `brief.json` (`description`, `transcript`) instead.
- `[+recording]` — optional flag. When present, the user explicitly asked you to attach the recording to that brief's ticket — always honor it (see `ticket.md` recording-attach rules).

Everything else (content type, full description text, `extra` k/v pairs, presence of `brief-<id>-extra.zip`) lives in `brief.json` on disk and discovered by `ls` — the skill reads those itself, the prompt does not duplicate them.

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

**Any ticket failed** → leave the folder alone. Don't try to surgically delete only the successful ones; keep the inbox intact as a clean recovery point. Narrate: **`Inbox left intact — N succeeded, M failed (see summary).`**

Never destroy a brief that never became a ticket.

## Step 6 — Single closing summary with ticket URLs

After cleanup, give one final message. **Every filed ticket gets its URL on its own line, prominently** — that's what the user is here for.

> Done. Filed in **Billing**:
> - https://linear.app/acme/issue/LIN-1234 — Date picker broken on Labels page
> - https://linear.app/acme/issue/LIN-1235 — Test plan export missing CSV option
> - https://linear.app/acme/issue/LIN-1236 — Add bulk delete to test cases
> - https://linear.app/acme/issue/LIN-1237 — Customer impersonation should warn on save
>
> Inbox cleared.
>
> If any team is wrong, just say which.

If tickets went to multiple teams, drop the "in **<team>**" header and instead suffix each line with `(<team>)`.

If anything failed, add a **Retained for retry** section at the bottom listing each retained brief with one line of why (e.g. `brief pqr-678 — Linear save_issue returned 500`).

URLs must be the actual ticket URLs returned by the tracker, not constructed identifiers. The user clicks them.

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
