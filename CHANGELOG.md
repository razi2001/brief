# Changelog

The extension's version is in `extension/manifest.json`. The web app deploys from `main`.

## 1.8.3 (2026-11-18)

Brief is open source.

- **Renamed** from Brief Cloud to Brief.
- **Admin views can't read tickets:** they read a fixed list of columns with no ticket content, pinned by tests. Owners come from `BRIEF_OWNER_EMAILS`.
- **What we see:** a page where every user sees their own row exactly as the admin does.
- **Row level security** on every database table.
- **Self-hosting:** `docker compose up`, a migration runner, a script that points the extension at your server, and a setup prompt for coding agents ([SELF_HOSTING.md](SELF_HOSTING.md)).
- **Anonymous telemetry** from self-hosted copies, counts only, off with `BRIEF_TELEMETRY=off` ([TELEMETRY.md](TELEMETRY.md)).
- **Audit prompt** for coding agents ([AUDIT.md](AUDIT.md)).
