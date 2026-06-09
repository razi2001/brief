-- Brief Cloud schema. Clerk owns identity; user_id is the Clerk user id (text).
-- No RLS: all access is server-side via the service-role client, scoped by user_id in code.

create table if not exists public.extension_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  token_hash text not null unique,
  label text,
  last_used_at timestamptz,
  created_at timestamptz default now(),
  revoked_at timestamptz
);
create index if not exists extension_tokens_user_idx on public.extension_tokens(user_id);

create table if not exists public.briefs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  status text not null default 'uploaded'
    check (status in ('uploaded','processing','filed','failed')),
  source_kind text check (source_kind in ('recording','screenshot','text','mix')),
  storage_prefix text not null,
  ticket_url text,
  ticket_identifier text,
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists briefs_user_idx on public.briefs(user_id);
