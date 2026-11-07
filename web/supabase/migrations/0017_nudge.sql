-- The extension's "Seen a bug?" card, set by the owner on /admin/card.
-- nudge_settings: one row, the card's text and button label (empty = built-in).
-- nudge_pushes: "show it now", to one person (user_id, the Clerk id) or to
-- everyone (null). The extension reads the newest one meant for it.
create table if not exists public.nudge_settings (
  id smallint primary key default 1 check (id = 1),
  message text not null default '',
  button text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.nudge_pushes (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  created_at timestamptz not null default now()
);
create index if not exists nudge_pushes_at_idx on public.nudge_pushes(created_at desc);
create index if not exists nudge_pushes_user_at_idx on public.nudge_pushes(user_id, created_at desc);

-- Service role only, like events: RLS on, no policies.
alter table public.nudge_settings enable row level security;
alter table public.nudge_pushes enable row level security;
