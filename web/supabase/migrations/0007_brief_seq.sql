-- Per-user sequential brief number ("brief-1", "brief-2"...). Shown as the ID
-- in the feed for briefs that don't have a tracker identifier yet (drafts and
-- in-flight filings), the way Linear shows ENG-1, ENG-2. Assigned once at
-- insert (BEFORE INSERT trigger, max+1 per user) and never renumbered, so a
-- brief's number is stable for its whole lifetime.

alter table public.briefs add column if not exists seq int;

-- Backfill existing rows: number each user's briefs by creation order.
with ranked as (
  select id, row_number() over (partition by user_id order by created_at asc, id asc) as rn
  from public.briefs
)
update public.briefs b
set seq = ranked.rn
from ranked
where ranked.id = b.id and b.seq is null;

create or replace function public.assign_brief_seq()
returns trigger as $$
begin
  if new.seq is null then
    select coalesce(max(seq), 0) + 1 into new.seq
    from public.briefs
    where user_id = new.user_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists briefs_assign_seq on public.briefs;
create trigger briefs_assign_seq
  before insert on public.briefs
  for each row execute function public.assign_brief_seq();
