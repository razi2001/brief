# Audit Brief

Instructions for a coding agent checking Brief's privacy claims. Check the code, not the docs.

1. Read [PRIVACY.md](PRIVACY.md). Each claim below must hold in the code.
2. **Owner views.** Which database columns and fields `/admin` and `/admin/activity` can read: `web/lib/admin-view.ts` (`OWNER_FIELDS`, `OWNER_COLUMNS`), `web/lib/admin-server.ts`, `web/lib/activity-server.ts`. Look for any other code path that reads briefs across users.
3. **Activity log.** What it stores: `web/lib/events.ts` (`pagePath`, `errorKind`, every `track()` call).
4. **Telemetry.** What leaves a self-hosted instance: `web/lib/telemetry.ts`, `web/lib/telemetry-server.ts`, `web/instrumentation.ts`. See [TELEMETRY.md](TELEMETRY.md).
5. **Extension.** What it sends and where: `extension/config.js`, `extension/cloud.js`, `extension/background.js`.
6. **Deletion.** What is removed after filing: `web/lib/agent/run-processing.ts` and the storage cleanup it calls.
7. **Row level security.** Every public table in `web/supabase/migrations` should have RLS on.
8. Run the guard tests:

   ```sh
   cd web && npm ci && npx vitest run lib/admin-view.test.ts lib/events-privacy.test.ts lib/telemetry.test.ts
   ```

Report every place where the code does more than PRIVACY.md says, with file and line.
