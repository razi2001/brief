-- Every table in public with row level security on and no policies, so only
-- the server's service-role key can read or write. Without this, the early
-- tables (briefs, extension_tokens, org_*) were readable through Supabase's
-- REST API by anyone holding the project's anon key. The app never uses the
-- anon key; this makes that a guarantee instead of a habit. Idempotent.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- The briefs bucket stays private: no storage policies are created, so only
-- signed URLs (minted by the server) can upload or read objects.
