# Architecture

```
Chrome extension (extension/)          Service (web/, Next.js)                Your tracker
 records tab + voice + console  ──►     transcribes, writes the ticket   ──►   Linear, Jira, GitHub,
 uploads to signed storage URLs         with OpenAI, files it with your        GitLab, Azure DevOps,
                                        tracker connection                     ClickUp, Notion, ...
                                              │
                         Clerk (sign-in) ─────┤
                         Supabase (Postgres + private Storage bucket)
```

## The extension

Chrome MV3, plain JavaScript, no build step. It records the tab and microphone, takes and annotates screenshots, and collects console errors and failed requests during the recording. It pairs with the service through a token the web app hands it, then uploads each brief straight to private storage through short-lived signed URLs. `extension/config.js` sets which server it talks to; `node extension/scripts/configure.mjs <url>` points it at your own.

## The service

A Next.js app with three jobs:

- **API for the extension:** pairing, signed upload URLs, transcription.
- **The ticket agent** (`web/lib/agent`): reads the transcript, screenshots and errors, writes a ticket with steps to reproduce, and files it with your tracker connection (`web/lib/trackers`).
- **The web app:** your tickets, drafts, settings and tracker connections.

Sign-in is Clerk. Data is Supabase: Postgres with row level security on every table, and a private storage bucket. Only the server's service-role key reads data.

## Folders

| Folder | What |
|---|---|
| `extension/` | The Chrome extension. |
| `web/` | The service. |
| `web/supabase/migrations/` | The whole database schema, applied in order by `web/scripts/migrate.mjs`. |
| `docker-compose.yml` | Self-hosting: a one-shot migrate step, then the app. |
| `docs/` | Screenshots, and the design notes features were built from. |
