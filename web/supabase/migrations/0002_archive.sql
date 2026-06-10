alter table public.briefs add column if not exists archived_at timestamptz;
create index if not exists briefs_user_active_idx on public.briefs(user_id) where archived_at is null;
