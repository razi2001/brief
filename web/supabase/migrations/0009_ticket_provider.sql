-- Which tracker a filed brief went to, recorded at filing time.
--
-- providerOf() used to INFER this from the ticket url's hostname, which worked
-- while there were exactly two providers with unmistakable domains. With seven
-- it stops being safe: a self-hosted GitLab, a Jira Data Center on a custom
-- domain, or an Azure DevOps Server instance all live on hostnames we can't
-- enumerate, and guessing wrong points the live sync at the wrong API.
--
-- The column is the truth for every brief filed from now on; hostname inference
-- stays as the fallback for rows that predate it (see providerOf in
-- lib/ticket-sync.ts), so no backfill is needed.
alter table public.briefs add column if not exists ticket_provider text;

-- The tickets feed groups filed briefs by provider to batch one live-sync call
-- per tracker, so this is read on every dashboard render.
create index if not exists briefs_ticket_provider_idx
  on public.briefs(user_id, ticket_provider)
  where ticket_provider is not null;
