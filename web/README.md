# Brief — web app

The hosted side of Brief. You connect a tracker (Linear today, Jira ready), pair the
Brief extension, and recorded bugs are turned into well-written tickets **by a hosted
agent** and filed automatically — no local coding agent needed.

```
Extension ──upload──▶  Next.js API  ──▶  OpenAI agent  ──▶  Linear / Jira
 (record)              (Supabase Storage)   (writes the ticket)   (real issue + evidence)
```

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind v4) — UI, API routes, and the agent.
- **Clerk** — user login (Google + email) **and** the tracker connection vault (Linear/Jira
  connected as OAuth accounts; tokens vended server-side).
- **Supabase** — Postgres (`extension_tokens`, `briefs`) + private Storage bucket `briefs`.
  Server-side only, via the service-role key, scoped by the Clerk user id.
- **OpenAI** (gpt-5.6-luna) — the agent that reads the report + keyframes and writes the ticket.
- Trackers via direct GraphQL/REST: `lib/linear.ts` (verified), `lib/jira.ts` (built, pending
  an Atlassian connection), behind the `lib/tracker.ts` abstraction.

## Setup

1. **Install deps**
   ```bash
   cd web
   npm install
   ```

2. **Env** — copy `.env.local.example` to `.env.local` and fill in:
   - **Clerk** (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) — enable Google +
     Email; add a **Linear** connection (custom credentials, scopes `read,write`), an
     **Atlassian** connection for Jira (scopes `read:jira-work write:jira-work offline_access`),
     and a **GitHub** connection (see [Trackers](#trackers)).
   - **Supabase** (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) — create a private
     bucket named `briefs` (or run `node --env-file=.env.local scripts/ensure-bucket.mjs`).
   - **OpenAI** (`OPENAI_API_KEY`; optional `AGENT_MODEL` and `AGENT_FAST_MODEL`, both default `gpt-5.6-luna`, see `lib/agent/model.ts`).
   - `APP_URL=http://localhost:3000`.
   - Optional `LINEAR_API_KEY` (personal key) for filing without the Clerk OAuth connection.

3. **Database** — apply the schema:
   ```bash
   node --env-file=.env.local scripts/apply-migration.mjs
   ```

4. **Run**
   ```bash
   npm run dev      # http://localhost:3000
   npm test         # unit tests (crypto, tokens, brief parsing, extauth, jira ADF)
   ```

## Trackers

Brief files into one tracker at a time: Linear, Jira, or GitHub. All three are
Clerk connected accounts — enable each in the Clerk dashboard (Configure → SSO
connections) and Clerk stores and refreshes the token.

### GitHub needs a scope Clerk's connection does not grant

Clerk's built-in connections have **no configurable scopes**, and their defaults
are sized for signing in. A real grant comes back as:

```
approved_scopes: read:user user:email
```

That identifies a user and cannot create an issue — `POST /repos/:owner/:repo/issues`
needs `repo`. Brief therefore passes `additionalScopes: ["repo"]` when connecting
(see `lib/clerk-strategies.ts`), which appends to the scopes requested at connect
time. Nothing to configure: the consent screen asks for repository access.

Two things worth knowing:

- The connection must be backed by an **OAuth App** (client id `Ov23li…`), not a
  **GitHub App** (`Iv23li…`). GitHub Apps grant access through per-repo
  installation and permissions, so scopes are ignored and repo listing returns
  only installed repositories.
- Set each repository's **Website** field. Targets carry it to the agent, which
  is how the page a bug was reported on gets matched to the repo that serves it.
  Without it, routing falls back to guessing from repository names.

If you ever need a scope combination a built-in connection can't express, a
provider can be pointed at a **custom Clerk connector** (which does expose
`base_scopes`) by setting `NEXT_PUBLIC_<PROVIDER>_CLERK_STRATEGY` — note that
custom connectors require a paid Clerk plan on production instances.

### Evidence

Linear and Jira upload screenshots to the tracker. GitHub has no public
image-upload API, so its issues embed them from `/api/evidence/<share_id>/…`,
authorized by the same unguessable share token as the public brief page. A
ticket filed to GitHub keeps working only while the brief still exists.

GitHub fetches images server-side, so evidence is only embedded when `APP_URL`
is publicly reachable — in local development the screenshots are left out rather
than rendered as permanently broken images.

## Pair the extension

Load `../extension` unpacked at `chrome://extensions`, open the ✦ popup, click
**Connect to Brief** → sign in → the web app pushes a token to the extension.
Then record a bug and hit stop — it uploads and files automatically. (Not connected →
the extension falls back to the original local zip export.)

## How filing works

`POST /api/briefs` (extension bearer token) creates a brief row + signed upload URLs.
The extension PUTs `brief.json` + keyframes + recording. `POST /api/briefs/:id/process`
picks the connected tracker, downloads the media, runs the OpenAI agent (which writes a
teammate-grade ticket: summary, steps to reproduce, expected/actual, console errors), uploads
the evidence to the tracker and embeds it, files the issue, and deletes the source media on
success. The dashboard auto-refreshes while briefs are processing.

## Status

- **Linear** — verified end-to-end (connect → record → real ticket with embedded evidence).
- **Jira** — implemented behind the tracker abstraction; needs an Atlassian connection in
  Clerk to go live (not yet verified against a real Jira site).
