-- Self-hosted instances' anonymous daily heartbeat (lib/telemetry.ts,
-- TELEMETRY.md). One row per instance, counts only.
create table if not exists public.instance_pings (
  instance text primary key,
  version text not null default '',
  users integer not null default 0,
  created7d integer not null default 0,
  filed7d integer not null default 0,
  failed7d integer not null default 0,
  trackers text[] not null default '{}',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

-- Service role only: RLS on, no policies.
alter table public.instance_pings enable row level security;
