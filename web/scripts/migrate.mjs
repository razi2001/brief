// Applies every migration in supabase/migrations that this database hasn't
// had yet, in order, and records each in public._brief_migrations.
//
//   node --env-file=.env.local scripts/migrate.mjs             # apply what's new
//   node --env-file=.env.local scripts/migrate.mjs --baseline  # an existing DB: record all as applied, run none
//   node --env-file=.env.local scripts/migrate.mjs --status    # list applied / pending
//
// Needs SUPABASE_DB_URL (Supabase dashboard > Connect > Session pooler).
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is not set (Supabase dashboard > Connect > Session pooler URI).");
  process.exit(1);
}

const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const mode = process.argv[2] ?? "";
const local = /@(localhost|127\.0\.0\.1|db|postgres)[:/]/.test(url);
const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(
    "create table if not exists public._brief_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  await client.query("alter table public._brief_migrations enable row level security");
  const done = new Set((await client.query("select name from public._brief_migrations")).rows.map((r) => r.name));
  const pending = files.filter((f) => !done.has(f));

  if (mode === "--status") {
    for (const f of files) console.log(`${done.has(f) ? "applied" : "pending"}  ${f}`);
  } else if (mode === "--baseline") {
    for (const f of pending) await client.query("insert into public._brief_migrations(name) values ($1)", [f]);
    console.log(`Recorded ${pending.length} migration(s) as applied without running them.`);
  } else if (pending.length === 0) {
    console.log("Database is up to date.");
  } else {
    for (const f of pending) {
      process.stdout.write(`Applying ${f} ... `);
      await client.query("begin");
      try {
        await client.query(readFileSync(join(dir, f), "utf8"));
        await client.query("insert into public._brief_migrations(name) values ($1)", [f]);
        await client.query("commit");
        console.log("ok");
      } catch (e) {
        await client.query("rollback");
        throw new Error(`${f}: ${e.message}`);
      }
    }
    console.log(`Applied ${pending.length} migration(s).`);
  }
} catch (e) {
  console.error("Migration failed:", e.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
