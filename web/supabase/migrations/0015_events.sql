-- What people do in Brief Cloud and on get-brief.app, for the owner's
-- /admin/activity. user_id is the Clerk id; null for website visitors.
create table if not exists public.events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id text,
  name text not null,
  props jsonb not null default '{}'::jsonb
);
create index if not exists events_user_at_idx on public.events(user_id, at desc);
create index if not exists events_name_at_idx on public.events(name, at desc);

-- Service role only, like tracker_connections: RLS on, no policies.
alter table public.events enable row level security;
