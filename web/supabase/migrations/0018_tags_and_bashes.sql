-- Tags: a person's own folders for their briefs. A brief can carry several.
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  color text not null default 'clay',
  created_at timestamptz not null default now()
);
-- One tag per name per person, whatever the capitals.
create unique index if not exists tags_user_name_idx on public.tags(user_id, lower(name));

create table if not exists public.brief_tags (
  brief_id uuid not null references public.briefs(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (brief_id, tag_id)
);
create index if not exists brief_tags_tag_idx on public.brief_tags(tag_id);

-- Bug bash: a timed session people join by link. A brief counts for a bash
-- when one of its members made it between joining and the end, so nothing is
-- written on the brief and the extension needs no change.
create table if not exists public.bashes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_by text not null,
  starts_at timestamptz not null default now(),
  -- When it is due to end; ended_at is set when the owner ends it early.
  ends_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.bash_members (
  bash_id uuid not null references public.bashes(id) on delete cascade,
  user_id text not null,
  joined_at timestamptz not null default now(),
  primary key (bash_id, user_id)
);
create index if not exists bash_members_user_idx on public.bash_members(user_id);

-- Service role only, like events: RLS on, no policies.
alter table public.tags enable row level security;
alter table public.brief_tags enable row level security;
alter table public.bashes enable row level security;
alter table public.bash_members enable row level security;
