-- Organizations: shared ticket preferences, and the reporter leaderboard.
--
-- An org in Brief is a TRACKER WORKSPACE - the people whose connected tracker
-- points at the same Linear organization / Jira site / GitHub org. There is
-- nothing to invite or administer: membership is a fact about the token,
-- resolved server-side (lib/org-server.ts) and cached here.
--
-- NOTE ON THE NO-RLS INVARIANT. 0001_init.sql records that there is no RLS and
-- that every access is "scoped by user_id in code". These two tables are the
-- first shared state in the schema, so that invariant needs restating rather
-- than quietly dropping: access is still entirely server-side through the
-- service-role client, but it is now scoped by ORG, and the org key is always
-- derived from a live tracker token - never from anything the client sent. A
-- client that could name its own org could read any org's leaderboard.

-- Which org each user resolved to, cached so a dashboard render doesn't cost a
-- tracker API call. Refreshed when missing or stale (see ORG_TTL_MS).
create table if not exists public.org_members (
  user_id     text primary key,
  org_key     text not null,
  org_name    text not null,
  provider    text not null,
  resolved_at timestamptz not null default now()
);
-- The leaderboard and the member count both start from "everyone in this org".
create index if not exists org_members_org_idx on public.org_members(org_key);

-- The shared ticket guidance, one row per org. Absent until someone sets it.
create table if not exists public.org_settings (
  org_key         text primary key,
  ticket_guidance text not null default '',
  updated_at      timestamptz not null default now(),
  -- Denormalized so "last changed by X" renders without a Clerk round trip on
  -- every Connections load.
  updated_by      text,
  updated_by_name text
);

-- Leaderboard aggregation.
--
-- Done in SQL so it stays one round trip no matter how big the org is, and so
-- the three title signals (night owl, long titles, month-over-month jump) come
-- back with the counts instead of costing three more queries.
--
-- `since` null means all time, in which case prev_filed is 0 - there is no
-- window before "everything". Otherwise the previous window is the same length
-- immediately before `since`, so "on a tear" compares like with like.
create or replace function public.org_leaderboard(member_ids text[], since timestamptz)
returns table (
  user_id    text,
  filed      bigint,
  night      bigint,
  avg_title  numeric,
  prev_filed bigint
)
language sql
stable
as $$
  with win as (
    select
      since as start_at,
      case when since is null then null::timestamptz
           else since - (now() - since) end as prev_start
  )
  select
    b.user_id,
    count(*) filter (
      where w.start_at is null or b.created_at >= w.start_at
    ) as filed,
    -- Captured between 22:00 and 06:00. Evaluated in the database's timezone,
    -- which is good enough for a joke title and keeps this a pure SQL read.
    count(*) filter (
      where (w.start_at is null or b.created_at >= w.start_at)
        and (extract(hour from b.created_at) >= 22
             or extract(hour from b.created_at) < 6)
    ) as night,
    coalesce(
      avg(length(coalesce(b.title, ''))) filter (
        where w.start_at is null or b.created_at >= w.start_at
      ),
      0
    ) as avg_title,
    count(*) filter (
      where w.prev_start is not null
        and b.created_at >= w.prev_start
        and b.created_at < w.start_at
    ) as prev_filed
  from public.briefs b
  cross join win w
  where b.user_id = any(member_ids)
    and b.status = 'filed'
    and b.archived_at is null
    and (w.prev_start is null or b.created_at >= w.prev_start)
  group by b.user_id
$$;

-- Everything here is reached through the service-role client. No browser role
-- should be able to call the aggregate directly.
revoke all on function public.org_leaderboard(text[], timestamptz) from public;
revoke all on function public.org_leaderboard(text[], timestamptz) from anon;
revoke all on function public.org_leaderboard(text[], timestamptz) from authenticated;
