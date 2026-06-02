# Playbook — Inbox (batched ticket filing)

The user is processing multiple briefs at once. Their prompt is one of:

> Use the brief skill to process my inbox: briefs abc-123, def-456, xyz-789.

…or, with no IDs listed:

> Use the brief skill to process my inbox.

Both mean the same thing: file tickets for everything currently in `~/Downloads/brief/`, group obvious duplicates, delete each brief after success.

## Step 1 — Discover briefs

If the user named brief IDs in the prompt, use that list.

Otherwise, **list everything** in `~/Downloads/brief/`:

```bash
ls ~/Downloads/brief/
```

Pick up every `brief-<id>.zip` and every extracted `brief-<id>/` folder. If both exist for the same id, use the folder (already extracted). Build the list yourself.

For each brief:
1. Extract the zip if it isn't already extracted
2. Read `brief.json`
3. Note `id`, `pageUrl`, `pageTitle`, `transcript`, `transcriptChunks`, `keyframeMeta`, `events`

Don't read keyframes yet — just metadata.

If the inbox is empty (no briefs found), say so briefly and stop: *"Inbox is empty — nothing to process."* Don't error out.

## Step 2 — Triage out loud

Before filing anything, **show the user your read** in a single message:

> Looking at your 7 briefs:
> - 5 bugs, 2 feature requests
> - Two of the bugs look like the same thing — both about the date picker on the Labels page. I'd dedupe those into one ticket with both recordings linked.
>
> Plan: **6 tickets** to file (1 deduped from 2 briefs)
>
> Proceed?

Wait for the user's confirmation before filing. (If the user explicitly said to proceed without checking, you can skip straight to filing — but default to showing the plan first.)

This triage step is critical because:
- The user can't watch you process 7 things one by one — too much output to read
- You'll occasionally misread something or miss a dupe — letting them correct once is much better than them spotting it after 5 tickets are filed
- It builds trust: they see you understood before you acted

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

> Process these briefs from ~/Downloads/brief/: a1b2c3 ("Checkout button dead"), d4e5f6 ("Logo too big"). Unzip brief-a1b2c3.zip and follow its skill/SKILL.md.

The prompt is intentionally short — it only tells you *where* to look and *which* briefs the user kept. The rules below are yours to apply. When the prompt names a subset:
- **Process only those briefs.** Ignore any other files in the folder — the user may have other briefs in progress that they haven't exported yet.
- **Use the given names** as a strong hint for each ticket's title (the user already told you what each one is about). The transcript and keyframes still provide the detail; the name anchors the intent.
- **Process those briefs**, then clear the whole folder at the end (see Step 5). The export hands off the user's full set, so once they're all filed nothing should remain.

If the prompt does NOT name a subset (just "process my inbox"), process everything in the folder and delete each brief as you file it.

## Step 4 — Process each ticket

For each item in your processed list (single brief or grouped briefs), follow `playbooks/ticket.md` — same rules apply (binary-search keyframes, inline images, no clarifying questions about team, etc.).

The only adjustment vs. solo ticket filing: be **concise** in the description. The user is processing several things at once; they're not going to read each ticket in detail. Lead with what's broken, then evidence, then technical notes — skip the speculation.

## Step 5 — Delete filed briefs, then clear the folder

As each ticket is successfully filed, delete that brief's files:

```bash
rm -rf ~/Downloads/brief/brief-<id>.zip
rm -rf ~/Downloads/brief/brief-<id>-extra.zip
rm -rf ~/Downloads/brief/brief-<id>/
```

For a grouped ticket that combined multiple briefs, delete ALL the source briefs in the group once the ticket is confirmed filed.

**End-of-run cleanup.** Once every brief in the batch has been filed successfully, clear out the whole folder so nothing stale is left behind:

```bash
rm -rf ~/Downloads/brief/*
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
