-- A bug bash stays open for some days (starts_at to ends_at), and each person
-- has their own clock: `minutes` from the moment they start (their row in
-- bash_members, joined_at). Nobody has to test at the same time.
alter table public.bashes add column if not exists minutes integer;
