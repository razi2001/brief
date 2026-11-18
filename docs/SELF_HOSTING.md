# Self-hosting Brief

Run Brief on your own machine or server, with your own accounts. Your recordings, tickets and tracker tokens then live only in your Supabase project, and only your OpenAI key processes them.

**You need:** Docker, Node 20+, Chrome, and free accounts at [Supabase](https://supabase.com), [Clerk](https://clerk.com) and [OpenAI](https://platform.openai.com) (pay as you go, about a cent per ticket).

## With a coding agent

Ask Claude Code (or any agent that can run commands): *Clone https://github.com/razi2001/brief and set it up for me by following docs/SELF_HOSTING.md.*

**Agent: do these steps, one at a time. "Me" is the person you are setting it up for.**

1. Read this file and .env.example. The manual steps below are the reference.
2. Check that docker, node (20+) and git are installed. Tell me what's missing and stop if anything is.
3. Copy .env.example to .env. Generate CONNECTIONS_KEY yourself.
4. Walk me through each account ONE AT A TIME, telling me exactly which page to open and which value to copy:
   Supabase (project URL, service_role key, Session pooler connection string with my DB password),
   Clerk (publishable key, secret key), OpenAI (API key),
   then ask which tracker my team uses and walk me through that tracker's OAuth app (web/TRACKERS.md),
   with the redirect URI <APP_URL>/api/connect/<provider>/callback.
   Write each value into .env as I give it. Never print secrets back to me or into any other file.
5. Ask me for my email and put it in BRIEF_OWNER_EMAILS. Tell me about BRIEF_TELEMETRY (TELEMETRY.md) and ask if I want it on or off.
6. Run: docker compose up -d --build. Show me the migrate logs and the web logs, and fix any error before going on.
7. Run: node extension/scripts/configure.mjs <APP_URL>. Then tell me how to load the extension folder unpacked in chrome://extensions,
   ask me for the extension id it shows, put it in NEXT_PUBLIC_EXTENSION_ID and rebuild (docker compose up -d --build web).
8. Have me open APP_URL, sign up, connect my tracker, record a 10 second test brief, and confirm the ticket landed.
9. Finish with a short summary: the URL, where .env is, how to update (git pull && docker compose up -d --build), and how to back up.

## The manual way

### 1. Get the code

```bash
git clone https://github.com/razi2001/brief.git brief && cd brief
```

```bash
cp .env.example .env
```

### 2. Supabase (database + file storage)

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard). Note the database password.
2. **Project Settings > API**: copy the Project URL into `NEXT_PUBLIC_SUPABASE_URL` and the `service_role` secret into `SUPABASE_SERVICE_ROLE_KEY`.
3. **Connect > Session pooler**: copy the URI into `SUPABASE_DB_URL` and put your password in it.

The migrate step creates every table (with row level security on) and the private `briefs` bucket. Nothing to click.

### 3. Clerk (sign-in)

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com), with Email and Google.
2. **API Keys**: copy them into `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.
3. On a real domain, add it under **Domains** and use the production keys.

### 4. OpenAI

Create a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys) and put it in `OPENAI_API_KEY`.

### 5. Your tracker

Brief connects to trackers with OAuth apps that you own. Fill only the ones your team uses: [web/TRACKERS.md](../web/TRACKERS.md) has the steps for each. The redirect URI is always:

```
<APP_URL>/api/connect/<provider>/callback      e.g. http://localhost:3000/api/connect/linear/callback
```

Generate the key that encrypts tracker tokens:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put it in `CONNECTIONS_KEY`. Changing it later disconnects every tracker.

### 6. Start it

```bash
docker compose up -d --build
```

`migrate` runs first (`docker compose logs migrate`), then the app listens on `APP_URL` (port 3000; set `PORT` to change it). For a public server, put it behind any HTTPS reverse proxy (Caddy, Traefik, nginx) and set `APP_URL` to the public address.

### 7. The extension

```bash
node extension/scripts/configure.mjs http://localhost:3000
```

Then open `chrome://extensions`, turn on **Developer mode**, **Load unpacked**, pick the `extension/` folder. Copy the id Chrome shows into `NEXT_PUBLIC_EXTENSION_ID` and rebuild (`docker compose up -d --build web`) so pairing needs no click.

To share it with your team, zip the configured `extension/` folder (or publish it privately on the Chrome Web Store for your Google Workspace).

### 8. Try it

Open `APP_URL`, sign up, connect your tracker in **Settings**, then click ✦ on any tab, say a sentence, stop. The ticket shows in **Tickets** and in your tracker.

## Running it

| | |
|---|---|
| Update | `git pull && docker compose up -d --build` (new migrations apply on start) |
| Logs | `docker compose logs -f web` |
| Back up | Supabase backs up the database daily on every plan; download them from the dashboard. |
| Owner views | Set `BRIEF_OWNER_EMAILS` to see usage at `/admin`. They never show ticket content ([PRIVACY.md](PRIVACY.md)). |
| Telemetry | One anonymous daily count, [TELEMETRY.md](TELEMETRY.md). `BRIEF_TELEMETRY=off` stops it. |
| Already have the tables? | `docker compose run --rm migrate node scripts/migrate.mjs --baseline` records them as applied. |

## Develop without Docker

```bash
cd web && npm ci && cp ../.env .env.local && node --env-file=.env.local scripts/migrate.mjs && npm run dev
```
