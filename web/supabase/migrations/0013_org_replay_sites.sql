-- Instant replay: which sites the extension keeps a rolling replay buffer on,
-- set once per org on Settings. Host patterns: "app.thunders.ai" (any port),
-- "localhost:3000" (that port), "*.thunders.ai" (the apex and every subdomain).
-- Additive: existing rows get an empty list, which records nothing.
alter table public.org_settings
  add column if not exists replay_sites text[] not null default '{}';
