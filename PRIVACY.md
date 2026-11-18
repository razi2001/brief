# Privacy, in the code

This page says what Brief stores, who can see it, and where in the code each claim lives, so you (or your agent) can check it. The legal privacy policy for the hosted app is at [cloud.get-brief.app/privacy](https://cloud.get-brief.app/privacy).

## What gets stored

| Data | Where | How long |
|---|---|---|
| Recording, audio, screenshots, keyframes, console errors, clicks (typed text masked) | Private Supabase Storage bucket, uploaded through short-lived signed URLs | Audio, keyframes and `brief.json` are deleted as soon as the ticket is filed. The screenshot stays, and the recording only if you chose to attach it, so the brief's page can show them. `web/lib/agent/run-processing.ts` |
| The written ticket: title, text, link, status | `briefs` table | Until you delete the brief. Delete removes the row and every file. `web/app/api/briefs/[id]/delete/route.ts` |
| Tracker tokens | `tracker_connections`, encrypted with AES-256-GCM (`CONNECTIONS_KEY`) | Until you disconnect. `web/lib/crypto.ts` |
| Account (name, email, photo) | Clerk | Until you delete the account |
| Activity log (pages opened, setup steps, "filed a ticket to Linear") | `events` table | Page paths have every id removed (`/b/:share`), failures keep only their kind (`Jira 400`). `web/lib/events.ts` |

Processing goes to OpenAI's API (transcription and writing). OpenAI does not train on API data by default. Self-hosters use their own key.

## What the operator can see

The people running a Brief server (for the hosted app, the Brief team; for a self-hosted one, you) get three owner pages, open only to the emails in `BRIEF_OWNER_EMAILS`:

- **Usage** (`/admin`): per ticket or draft, who made it, their workspace, which tracker, its status and when. **No title, no text, no recording, no share link, no tracker link.**
- **Activity** (`/admin/activity`): sign-ups, setup progress, and the activity log above.
- **Bug card** (`/admin/card`): sends the extension's reminder popup and shows whether it was seen.

How that is enforced:

- `OWNER_COLUMNS` in `web/lib/admin-view.ts` is the only list of `briefs` columns the usage view selects. `OWNER_FIELDS` is the only list of fields a row carries. Both are pinned by `web/lib/admin-view.test.ts`: adding a content column fails CI.
- Every person can open **What we see** (`/what-we-see`, linked from Settings). It renders their own page of the Activity view with the same component and loader the operator uses, and the list of usage fields straight from `OWNER_FIELDS`.

What code can't promise: whoever holds the database password can read the `briefs` table directly. The hosted database is not encrypted per user. If that matters for your team, [self-host](SELF_HOSTING.md): then the only person with that password is you.

## Database access

Every table has row level security on with no policies (`web/supabase/migrations/0023_rls_everywhere.sql`), and the app never uses the Supabase anon key. Only the server's service-role key reads or writes. Your teammates in the same tracker workspace see the tickets they would see in the tracker anyway (team feed, competitions); queries are scoped by user and org in `web/lib/*-server.ts`.

## Share links

Every filed brief has a page at an unguessable address (`/b/<share id>`) so the tracker can show its screenshots. Anyone with the link can open it, like an unlisted video. The owner views never show these links, and the activity log strips them from page paths.

## Self-hosted instances

A self-hosted server sends one anonymous heartbeat a day: see [TELEMETRY.md](TELEMETRY.md). It contains counts only and is off with `BRIEF_TELEMETRY=off`.

## Audit it with your agent

Ask Claude Code or any coding agent to follow [AUDIT.md](AUDIT.md). Found a gap? Please report it as described in [SECURITY.md](SECURITY.md).
