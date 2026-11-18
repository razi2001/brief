# Contributing

Thanks for helping. Bugs, ideas and pull requests are all welcome.

## Run it locally

```bash
cd web && npm ci
```

```bash
cp ../.env.example .env.local
```

Fill `.env.local` ([SELF_HOSTING.md](SELF_HOSTING.md) says where each key comes from), then:

```bash
node --env-file=.env.local scripts/migrate.mjs
```

```bash
npm run dev
```

Point the extension at it and load `extension/` unpacked in `chrome://extensions`:

```bash
node ../extension/scripts/configure.mjs http://localhost:3000
```

Don't commit the configured `extension/config.js` and `manifest.json`; switch back with `configure.mjs https://cloud.get-brief.app`.

## Checks

```bash
cd web && npx tsc --noEmit && npm run lint && npm test
```

```bash
node --test extension/test/*.test.mjs
```

## Guidelines

- **Privacy changes are explicit.** If a change makes the owner views, the activity log or telemetry see more, update `OWNER_FIELDS` / `OWNER_COLUMNS` / `PING_FIELDS` and their tests, and say it in [PRIVACY.md](PRIVACY.md) or [TELEMETRY.md](TELEMETRY.md) in the same PR.
- **Schema changes** are a new numbered file in `web/supabase/migrations/`. Make it idempotent (`if not exists`) and turn RLS on for new tables.
- **UI copy** is short labels and controls, no instructional paragraphs, no em dashes.
- Next.js here is v16: the middleware file is `web/proxy.ts`, and route `params` are a `Promise`. Read `web/node_modules/next/dist/docs/` before using an API you're unsure of.
- Keep PRs focused, with a sentence on how you checked it works.
