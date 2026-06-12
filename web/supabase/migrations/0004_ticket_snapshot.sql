-- Last-known snapshot of the filed ticket, persisted so the feed shows the
-- real ticket title and tracker status even when the live sync fails (expired
-- token, tracker outage) or the row falls outside the per-load sync window.
-- Written at filing time and refreshed by the dashboard's live sync.
alter table public.briefs add column if not exists ticket_title text;
alter table public.briefs add column if not exists ticket_state_name text;
alter table public.briefs add column if not exists ticket_state_color text;
