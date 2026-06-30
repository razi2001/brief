-- Draft-first: a brief can be written up but not yet filed to a tracker.
-- The owner exports a draft to Linear/Jira from its page (POST /api/briefs/:id/
-- export); until then it lives as a 'drafted' brief with a body + shareable
-- page. Widen the status check to allow the new state.
alter table public.briefs drop constraint if exists briefs_status_check;
alter table public.briefs
  add constraint briefs_status_check
  check (status in ('uploaded', 'processing', 'drafted', 'filed', 'failed'));
