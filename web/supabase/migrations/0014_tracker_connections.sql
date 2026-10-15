-- App-owned tracker connections, for providers whose token Clerk does not hold.
--
-- Linear, Jira and GitHub are Clerk "connected accounts" - Clerk stores and
-- refreshes those tokens and we never see a refresh token. GitLab, Azure
-- DevOps, ClickUp, Notion, Trello, Asana and Monday have no Clerk connection.
-- Clerk has no built-in provider for most of them, a Clerk custom OAuth
-- connector is a paid feature in production, and Trello's authorization flow
-- is not OAuth 2.0 at all (so even a custom connector, which requires OAuth
-- 2.0, could not cover it). Clerk does have GitLab and Notion, but production's
-- Clerk plan refuses a fourth social connection.
--
-- For those seven we run the OAuth dance ourselves and keep the result here.
-- Tokens are encrypted at rest with AES-256-GCM (lib/crypto.ts) under
-- CONNECTIONS_KEY - the column holds ciphertext, never a usable token, so a
-- database dump alone does not hand over anyone's tracker.
create table if not exists public.tracker_connections (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  -- An OwnedProvider: 'gitlab' | 'azure' | 'clickup' | 'notion' | 'trello' |
  -- 'asana' | 'monday'. Not constrained by a CHECK so adding a provider is a
  -- code change, not a migration.
  provider text not null,
  access_token_enc text not null,
  -- Null where the provider issues non-expiring tokens (ClickUp, Trello,
  -- Monday, and Notion unless it sends a refresh token).
  refresh_token_enc text,
  -- Null means "never expires" (ClickUp, Trello, Monday, usually Notion);
  -- otherwise the refresh path kicks in early.
  expires_at timestamptz,
  -- Resolved once at connect time so filing doesn't re-derive them: the picked
  -- workspace (workspaceId, workspaceName), a display label for the
  -- Connections page (label), plus provider handles such as the Trello member
  -- id.
  account_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Brief files into ONE tracker, so a user has at most one row per provider and
-- reconnecting must update in place rather than pile up duplicates. The unique
-- index is what lets the callback route upsert on (user_id, provider).
create unique index if not exists tracker_connections_user_provider_idx
  on public.tracker_connections(user_id, provider);

-- Every other table in this schema runs without RLS (0001_init.sql), but this
-- one holds credentials, so it is locked down anyway. There are no policies on
-- purpose: with RLS on and nothing granted, the anon and authenticated roles
-- read nothing, and only the service-role client (which bypasses RLS) can
-- touch a row. If a browser-side Supabase client ever ships, this table stays
-- out of its reach.
alter table public.tracker_connections enable row level security;
