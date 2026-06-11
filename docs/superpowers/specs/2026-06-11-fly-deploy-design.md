# Brief Cloud — Fly.io deployment design

**Date:** 2026-06-11
**Status:** Approved ("go please")

## Goal

Deploy the Brief Cloud Next.js app (`web/`) to Fly.io at `cloud.get-brief.app`,
and point the extension at it. Supabase, Clerk, and OpenAI stay external. First
deploy uses the existing dev Clerk instance and the existing Supabase project.

## Decisions

- **Domain:** `cloud.get-brief.app` (new subdomain — must be added to the
  extension's `externally_connectable`, which currently lists `app.get-brief.app`).
- **Clerk:** ship with the current **dev** keys first; production Clerk later.
- **Supabase:** **reuse** the current project (migrations 0001–0003 + `briefs`
  bucket already applied).
- **LLM:** **OpenAI** (matches `lib/agent/process-brief.ts` → `gpt-4o`,
  `OPENAI_API_KEY`). No agent code change.

## Architecture

One Fly app, one always-on machine, serving the Next app (UI + API routes +
the OpenAI agent). There is **no separate API service** — `/api/*` is the same app.

```
Extension ──▶ cloud.get-brief.app (Fly: Next app)
   │              ├─ /connect            → mints + pushes extension token
   │              ├─ /api/briefs (POST)  → create row + Supabase signed upload URLs
   │              └─ /api/briefs/:id/process (POST, bearer) → after() OpenAI agent → files to Linear/Jira
   └── PUT files ─────────────────────────▶ Supabase Storage (signed URLs, direct — not via Fly)
Clerk (dev)  ── auth for /connect + UI.    Supabase Postgres+Storage ── data.    OpenAI ── agent.
```

### Fly machine
- `min_machines_running = 1`, `auto_stop_machines = false` — so the `after()`
  background agent run (the route returns immediately, files in the background)
  is never cut, and there are no cold starts.
- `shared-cpu-1x`, 1024 MB. `internal_port = 3000`. `force_https`. Health check
  on `/` (anon → 307 to /sign-in, which is healthy).

## Containerization

- `next.config.ts`: add `output: "standalone"`.
- Multi-stage `web/Dockerfile`: node 20-alpine → `npm ci` + `npm run build` →
  slim runtime copying `.next/standalone`, `.next/static`, `public`. Runs
  `node server.js` on port 3000.
- `web/.dockerignore` (node_modules, .next, .env*, etc.).
- Build context is `web/`.

## Env / secrets

`NEXT_PUBLIC_*` are inlined at **build time**, so they are **Docker build args**;
server-only values are runtime `fly secrets`.

- **Build args:** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-in`.
- **Runtime secrets:** `CLERK_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `OPENAI_API_KEY`, `APP_URL=https://cloud.get-brief.app`, optional
  `LINEAR_API_KEY`. (`SUPABASE_DB_URL` only needed locally for migrations.)

## Domain + Supabase CORS

- `fly certs add cloud.get-brief.app` + DNS CNAME `cloud` → the Fly app
  (`brief-cloud.fly.dev`), plus the Fly-provided ACME validation records.
- Verify **Supabase Storage CORS** allows `PUT` from the extension (origin
  `chrome-extension://…`); set allowed origins to `*` (or the extension origin)
  if uploads are blocked.

## Extension wiring

- `extension/cloud.js`: `APP_URL` → `https://cloud.get-brief.app`, with a
  commented `http://localhost:3000` line for local dev (single switch).
- `extension/manifest.json`: add `https://cloud.get-brief.app/*` to
  `externally_connectable.matches` (keep localhost + app.get-brief.app).
- No other change — bearer-token API, `<all_urls>` host permission, and the
  wildcard CORS already work cross-origin.

## What the human does (can't be automated here)

1. Install flyctl + `fly auth login`.
2. `fly launch --no-deploy` (or `fly apps create brief-cloud`) from `web/`.
3. Set the build args + `fly secrets set …` with real values.
4. `fly deploy`.
5. `fly certs add cloud.get-brief.app` → add the CNAME + ACME records at the DNS host.
6. Check/relax Supabase Storage CORS for the signed-URL PUT.
7. Reload the extension (APP_URL now prod) and pair via Brief Cloud.

## Out of scope (later)

- Production Clerk instance + its DNS.
- Publishing the extension to the Chrome Web Store.
- Promo image regeneration.
- CI/CD pipeline (manual `fly deploy` for now).
