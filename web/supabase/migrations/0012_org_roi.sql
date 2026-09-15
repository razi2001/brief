-- The numbers behind the dashboard's one-line case for Brief.
--
-- Only measured quantities live here. "Writing time saved" is an estimate and
-- is deliberately NOT computed in SQL - it needs an assumption about how long a
-- report takes by hand, and an assumption belongs somewhere a reader can see
-- and argue with it (lib/roi.ts), not buried in a database function where it
-- would look like a fact.
create or replace function public.org_roi(member_ids text[])
returns table (
  filed         bigint,
  with_evidence bigint,
  avg_seconds   numeric
)
language sql
stable
as $$
  select
    count(*) as filed,
    -- A recording or a screenshot is the quality signal we can actually
    -- observe: the report carries proof rather than a sentence of prose.
    count(*) filter (
      where b.source_kind in ('recording', 'screenshot', 'mix')
    ) as with_evidence,
    -- Capture to filed. Rows where the timestamps haven't moved tell us
    -- nothing, so they are excluded rather than dragging the mean to zero.
    coalesce(
      avg(extract(epoch from (b.updated_at - b.created_at)))
        filter (where b.updated_at > b.created_at),
      0
    ) as avg_seconds
  from public.briefs b
  where b.user_id = any(member_ids)
    and b.status = 'filed'
    and b.archived_at is null
$$;

revoke all on function public.org_roi(text[]) from public;
revoke all on function public.org_roi(text[]) from anon;
revoke all on function public.org_roi(text[]) from authenticated;
