-- The user-given brief name, captured at file time so the dashboard can show a
-- meaningful label while a ticket is still being created (before the tracker
-- title exists). Optional; live tracker title takes precedence once filed.
alter table public.briefs add column if not exists title text;
