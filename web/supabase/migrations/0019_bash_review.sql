-- Bug bash review. A live session holds what its members report as drafts;
-- when it ends, the reports are put in groups (one per bug) and whoever
-- started it files one ticket per group. A contest (days, not minutes) holds
-- nothing: its tickets are filed as usual, with the contest's name as a label.
alter table public.bashes add column if not exists hold boolean not null default false;
-- When the reports were first put in groups. Null until then.
alter table public.bashes add column if not exists grouped_at timestamptz;

create table if not exists public.bash_groups (
  id uuid primary key default gen_random_uuid(),
  bash_id uuid not null references public.bashes(id) on delete cascade,
  title text not null,
  position integer not null default 0,
  -- The ticket this group became, and the claim that stops it becoming two.
  ticket_url text,
  ticket_identifier text,
  ticket_provider text,
  filing_started_at timestamptz,
  filed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists bash_groups_bash_idx on public.bash_groups(bash_id);

-- Where each report of a bash sits: in a group, or dropped from the review.
-- A brief is reviewed in one bash only.
create table if not exists public.bash_briefs (
  brief_id uuid primary key references public.briefs(id) on delete cascade,
  bash_id uuid not null references public.bashes(id) on delete cascade,
  group_id uuid references public.bash_groups(id) on delete set null,
  dropped boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists bash_briefs_bash_idx on public.bash_briefs(bash_id);
create index if not exists bash_briefs_group_idx on public.bash_briefs(group_id);

-- Service role only, like events: RLS on, no policies.
alter table public.bash_groups enable row level security;
alter table public.bash_briefs enable row level security;
