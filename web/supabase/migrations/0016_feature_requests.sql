-- Feature requests from the Requests tab. Every signed-in user reads the board;
-- only the owner sets a status. Requests are anonymous: user_id (the Clerk id)
-- exists only for the daily cap, one vote per person and the sender's own
-- "You" mark. No page or API ever returns it.
create table if not exists public.feature_requests (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  title text not null,
  body text not null default '',
  status text not null default 'open'
    check (status in ('open', 'planned', 'in_progress', 'shipped', 'declined')),
  created_at timestamptz not null default now(),
  status_changed_at timestamptz
);
create index if not exists feature_requests_user_at_idx on public.feature_requests(user_id, created_at desc);

-- One upvote per person per request. The sender's own is added with the request.
create table if not exists public.feature_request_votes (
  request_id uuid not null references public.feature_requests(id) on delete cascade,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);
create index if not exists feature_request_votes_user_idx on public.feature_request_votes(user_id);

-- Service role only, like events: RLS on, no policies.
alter table public.feature_requests enable row level security;
alter table public.feature_request_votes enable row level security;
