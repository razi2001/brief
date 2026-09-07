-- One capture must never become two tracker tickets.
--
-- 'processing' meant two different things: the model is WRITING the ticket up
-- (draft path) or the agent is FILING it to Linear/Jira. Being indistinguishable
-- in the row, a filing run looked like an unwritten draft to the brief page, so
-- opening the page mid-filing streamed a draft over it, flipped the brief to
-- 'drafted' and offered "Export to Linear" again - filing a SECOND ticket for a
-- capture that already had one.
--
-- filing_started_at is the filing claim: stamped when a filing run starts,
-- cleared when it fails without creating a ticket. Every path that can create a
-- ticket claims first (see lib/brief-filing.ts), and the claim is taken in the
-- WHERE clause so two concurrent requests can't both win.
alter table public.briefs add column if not exists filing_started_at timestamptz;

-- Briefs filed before this migration have a ticket_url, which is the permanent
-- "already filed" guard - nothing to backfill.
