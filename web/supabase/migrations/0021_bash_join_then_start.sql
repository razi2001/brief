-- Joining a bug bash and starting your own time in it are two steps: a row in
-- bash_members says you joined (possible before its start date), started_at
-- says when your own clock began (only while it is open).
alter table public.bash_members add column if not exists started_at timestamptz;
