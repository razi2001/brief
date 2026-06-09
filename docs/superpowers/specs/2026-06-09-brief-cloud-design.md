# Brief Cloud — Design (v1)

**Date:** 2026-06-09
**Status:** Approved for planning
**Scope:** Thin end-to-end slice, Linear only.

## Background

Brief today is a Chrome extension that is **accountless and 100% local**. The user records a
bug (voice + screen + console logs), the extension writes a self-contained `brief-<id>.zip` to
`~/Downloads/brief/`, and the user pastes a prompt into **their own coding agent**. That agent
runs the bundled skill (`extension/skill/SKILL.md` + `playbooks/`) to analyze keyframes, map the
transcript, infer the team, and file the ticket via the agent's own tracker MCP.

**Brief Cloud inverts this.** It introduces an account, a stored connection to the user's tracker,
and a hosted Claude agent that processes the brief and files the ticket directly — so the user's
own coding agent is no longer in the loop. The extension's "Export" step becomes "Create ticket".

This is a fundamental product shift in two ways:
1. There is now an **account** (Brief was previously accountless).
2. Media now **leaves the machine** (Brief previously never uploaded the recording).

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Where the brief→ticket intelligence runs | **Cloud agent (full SaaS)** — our backend runs a Claude agent |
| v1 scope | **Thin end-to-end, Linear only** |
| Tracker connection | **Linear official remote MCP** (`mcp.linear.app`) + OAuth; we store tokens |
| Stack | **Next.js (App Router, TypeScript) + Supabase** (Auth + Postgres + Storage) |
| Media handling | **Upload → process → delete on success** (mirrors today's ephemeral-capture model) |
| Sign-in | **Google OAuth + email magic link** (both) |
| Processing model | **Claude Sonnet 4.6** by default (configurable to Opus) |

## Architecture

### Repo layout (monorepo in `brief-cloud/`)

- `extension/` — existing Chrome extension, modified for pairing + "Create ticket"
- `web/` — new Next.js app: web UI **and** API routes **and** the processing agent
- `docs/superpowers/specs/` — specs (this doc)

### Three runtime pieces

1. **Next.js web app** (deploy: Vercel) — sign-in, dashboard, "Connect Linear" OAuth flow,
   extension pairing page, and API routes (`/api/briefs`, `/api/briefs/:id/process`, OAuth callbacks).
2. **Supabase** — Auth (Google + magic link), Postgres (profiles, connections, briefs,
   extension tokens), one private Storage bucket for media.
3. **Claude agent** — runs inside a Next.js route/task, connects to `mcp.linear.app` with the
   user's stored OAuth token, files the ticket.

### End-to-end flow

```
1. Extension → "Connect to Brief Cloud" → opens web app, user signs in (Google / magic link)
2. Dashboard → "Connect Linear" → OAuth consent → store token (encrypted) in `connections`
3. Web app pushes an extension token back to the extension (pairing via externally_connectable)
4. User records a brief (capture flow unchanged). Primary CTA is now "Create ticket"
5. Extension requests a signed upload URL → uploads brief.json + keyframes + recording →
   creates `briefs` row (status=uploaded)
6. Extension calls POST /api/briefs/:id/process → Claude agent downloads media, runs the
   ported filing skill, files the Linear ticket via MCP
7. Success → store ticket_url, status=filed, DELETE media. Extension shows "Ticket created → [link]"
8. Failure → status=failed, KEEP media, surface error, allow retry
```

The key move: today's `SKILL.md` + `playbooks/ticket.md` (keyframe binary-search, transcript→
keyframe mapping, banned-vocabulary rules, infer-the-team, inline image embeds) become the
**server-side agent's system prompt**.

## Data model (Supabase Postgres)

All tables have Row-Level Security; users only access their own rows.

### `profiles`
`id` (= `auth.users.id`), `email`, `created_at`. Standard Supabase pattern, auto-created on signup.

### `connections`
`id`, `user_id`, `provider` (`'linear'`), `access_token` *(encrypted)*, `refresh_token`
*(encrypted)*, `scope`, `external_account_id`, `external_account_name`, `status`
(`active` | `broken`), `created_at`, `updated_at`. One row per connected tracker.

### `extension_tokens`
`id`, `user_id`, `token_hash` (we store a hash; the secret is shown to the extension once),
`label`, `last_used_at`, `created_at`, `revoked_at`. Bearer token the extension sends on API
calls; revocable.

### `briefs`
`id`, `user_id`, `status` (`uploaded` | `processing` | `filed` | `failed`), `source_kind`
(`recording` | `screenshot` | `text` | `mix`), `storage_prefix`, `ticket_url`,
`ticket_identifier`, `error`, `created_at`, `updated_at`. The **row is retained** as history;
only the media is deleted on success.

### Token encryption
Tracker OAuth tokens are encrypted at rest with app-level AES using a server-only key
(env var) in a small `web/lib/crypto.ts`. Portable; can move to Supabase Vault later.

### Storage
Private bucket `briefs`, objects under `{userId}/{briefId}/`: `brief.json`, `keyframes/*.png`,
`recording.webm`, `screenshot.png`. Extension uploads via **signed upload URLs**; the agent
reads via **signed read URLs**. All objects under the prefix are deleted when status → `filed`.

## The processing agent

`POST /api/briefs/:id/process`:
1. Verify the bearer token (hash lookup in `extension_tokens`); load the brief row + the user's
   Linear `connection`.
2. Download the brief media from Storage into a temp working dir.
3. Run a **Claude Agent SDK** session with:
   - **System prompt** = ported `SKILL.md` + `ticket.md` rules: keyframe binary-search (3–5
     strategic frames), transcript→keyframe mapping (±2000ms), banned-vocabulary list, inline
     image embeds via markdown, infer-the-team from page URL/connected workspace, narrate each
     step, never ask mid-flow.
   - **Filesystem tools** scoped to the temp dir (reads `brief.json`/keyframes exactly like today).
   - **Linear remote MCP** (`mcp.linear.app`) configured with the user's OAuth token — provides
     `create-issue`, attachment upload, `list-teams`, etc.
   - **Structured final output**: `{ ticketUrl, ticketIdentifier, summary }`.
4. On success: write `ticket_url` / `status=filed`, **delete media**, return the link.
   On error: `status=failed`, keep media, return the error.

**Model:** Claude Sonnet 4.6 by default (configurable to Opus).

**Long-running caveat:** v1 runs synchronously with a generous timeout; the extension polls brief
status. If real briefs exceed serverless limits, Phase 2 moves processing to a queue/worker. Not
built in v1.

## Extension changes & security

**Pairing (no copy-paste):** add `externally_connectable` to `manifest.json` scoped to the app
domain. The web "connect" page, once authed, calls
`chrome.runtime.sendMessage(extensionId, { token })`; `background.js` listens via
`onMessageExternal` and stores the token in `chrome.storage`.

**CTA change:** when the extension has a paired token **and** the account has an active Linear
connection, the primary button becomes **"Create ticket"** (replacing "Export"). If not connected,
it **falls back to today's local export** — graceful degradation, existing flow unbroken.

**API auth:** every `/api/*` call from the extension carries the bearer token; the server validates
it against `extension_tokens` (by hash) and scopes all queries to that `user_id`.

**Network permissions:** add the app domain to `host_permissions`.

## Error handling

- Upload failure → retry client-side.
- Expired Linear token → attempt refresh; on failure mark `connection.status=broken` and prompt
  re-connect in the dashboard.
- Agent / MCP failure → `status=failed`, keep media, surface the error in the extension and
  dashboard, allow retry.
- All data access scoped by RLS + token `user_id`.

## Testing

- **Unit:** extension-token issue/verify, token encryption round-trip, OAuth callback handling,
  storage URL signing.
- **Integration:** against a **Linear test workspace** — upload a fixture brief → call process →
  assert a real Linear issue is created with an inline image, then assert media was deleted.
- **Extension:** paired-flow tested manually with a fixture brief; export fallback verified when
  not connected.

## MVP boundary

**IN (v1):**
- Google + magic-link auth
- Connect Linear (OAuth), store/encrypt token
- Extension pairing via `externally_connectable`
- Upload brief media (signed URLs)
- Cloud Claude agent files a Linear ticket via MCP
- Delete media on success
- Dashboard: connection status + recent briefs (status + ticket links)

**OUT (later phases):**
- Jira (and other trackers)
- Brief history / media retention
- Billing
- Team / multi-seat accounts
- Queue/worker scaling for long briefs
- Retry-UI polish
- Server-side quality / banned-word post-check
