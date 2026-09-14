-- Remember which accounts we tried to place in an org and couldn't.
--
-- Membership resolution caches SUCCESS in org_members, but nothing recorded a
-- failure. Plenty of accounts can never resolve - no tracker connected, a
-- revoked token, ids left over from another Clerk instance - so every warm-up
-- pass retried all of them, forever. With a small per-load budget that meant
-- the dead accounts consumed it on every render and the people behind them
-- were never reached; the leaderboard stalled a few members short and looked
-- broken.
--
-- With misses recorded, one pass can attempt everyone outstanding and later
-- passes skip the known-hopeless until the entry ages out - so a token that
-- gets reconnected is still picked up, just not on every page load.
create table if not exists public.org_resolve_misses (
  user_id  text primary key,
  tried_at timestamptz not null default now()
);

-- The warm-up reads this by recency on every pass.
create index if not exists org_resolve_misses_tried_idx
  on public.org_resolve_misses(tried_at);
