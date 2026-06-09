// Generic migration runner for Brief Cloud.
// Applies the latest SQL file in supabase/migrations to the Supabase Postgres.
//
// Usage (Node 20+, from web/):
//   node --env-file=.env.local scripts/apply-migration.mjs            # latest migration
//   node --env-file=.env.local scripts/apply-migration.mjs 0001_init  # a specific one
//
// Requires SUPABASE_DB_URL in the environment (loaded via --env-file=.env.local).
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "supabase", "migrations");

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("SUPABASE_DB_URL is not set. Run with: node --env-file=.env.local scripts/apply-migration.mjs");
  process.exit(1);
}

const all = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
if (all.length === 0) {
  console.error(`No .sql migrations found in ${migrationsDir}`);
  process.exit(1);
}

const arg = process.argv[2];
let file;
if (arg) {
  const want = arg.endsWith(".sql") ? arg : `${arg}.sql`;
  file = all.find((f) => f === want);
  if (!file) {
    console.error(`Migration "${want}" not found. Available: ${all.join(", ")}`);
    process.exit(1);
  }
} else {
  file = all[all.length - 1];
}

const sql = readFileSync(join(migrationsDir, file), "utf8");

const client = new pg.Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log(`Applying migration: ${file}`);
  await client.query(sql);
  console.log("Migration applied successfully.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
