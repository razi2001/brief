-- Make every filed brief a shareable, hosted "perfect ticket" page.
--
-- The agent already writes a clean markdown body, but only the title was kept;
-- we now persist the body too. `share_id` is an unguessable per-brief token -
-- the public page is served at /b/<share_id> (no auth). The screenshot (and the
-- recording, when the reporter chose to attach it) are kept in storage rather
-- than deleted at filing time, so the page can embed them.
alter table public.briefs add column if not exists ticket_body text;
alter table public.briefs add column if not exists share_id text;
create unique index if not exists briefs_share_id_idx on public.briefs(share_id);
