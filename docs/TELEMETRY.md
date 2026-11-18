# Telemetry

A self-hosted Brief sends one small JSON message a day to `https://cloud.get-brief.app/api/telemetry`, so the project knows how many instances run and whether filing works for them. This is the whole message:

```json
{
  "instance": "3f2a9c...",
  "version": "0.1.0",
  "users": 12,
  "created7d": 40,
  "filed7d": 37,
  "failed7d": 1,
  "trackers": ["jira", "linear"]
}
```

| Field | What |
|---|---|
| `instance` | sha256 of your Supabase URL, cut to 32 characters. Stable, and says nothing about you. |
| `version` | The web app's version. |
| `users` | Accounts that made at least one brief, ever. |
| `created7d`, `filed7d`, `failed7d` | Briefs in the last 7 days. |
| `trackers` | Tracker kinds that got a ticket in the last 7 days. |

No names, emails, workspace names, URLs, titles or ticket text. The receiver drops any other field and stores one row per instance, overwritten daily, without your IP.

The server logs the exact message each time it sends one (`[telemetry] sending ...`).

**Turn it off:** `BRIEF_TELEMETRY=off` in `.env`, then `docker compose up -d`.

Code: `web/lib/telemetry.ts` (the message), `web/lib/telemetry-server.ts` (sending), `web/instrumentation.ts` (the daily timer), `web/app/api/telemetry/route.ts` (the receiver). `web/lib/telemetry.test.ts` fails if a field is added without updating this page.
