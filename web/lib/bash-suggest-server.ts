import { createAdminSupabase } from "@/lib/supabase/server";
import { groupOfState } from "@/lib/status-group";
import { suggestAreas } from "@/lib/bash-ai";
import { MAX_TICKETS, MIN_TICKETS, WINDOW_DAYS, type PastTicket, type Suggestion } from "@/lib/bash-suggest";

/**
 * Bash suggestions for one person: the areas their team's recent tickets
 * cluster in. "Their team" is the tracker workspace Brief already knows they
 * share (org_members); without one, their own tickets.
 *
 * The answer is kept for a few hours per person, in this server process (the
 * app runs as one always-on machine): the start page asks every time it opens,
 * and the tickets of the last two months don't change by the minute.
 */

const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: Suggestion[] }>();
/** Answers being worked out right now: a second ask for the same person waits for the first. */
const asking = new Map<string, Promise<Suggestion[]>>();

export function suggestBashes(userId: string): Promise<Suggestion[]> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.value);
  const running = asking.get(userId);
  if (running) return running;
  const job = work(userId).finally(() => asking.delete(userId));
  asking.set(userId, job);
  return job;
}

async function work(userId: string): Promise<Suggestion[]> {

  const db = createAdminSupabase();
  let userIds = [userId];
  const me = await db.from("org_members").select("org_key").eq("user_id", userId).maybeSingle();
  const orgKey = (me.data as { org_key: string } | null)?.org_key;
  if (orgKey) {
    const mates = await db.from("org_members").select("user_id").eq("org_key", orgKey).limit(500);
    const ids = ((mates.data ?? []) as { user_id: string }[]).map((m) => m.user_id);
    if (ids.length) userIds = [...new Set([userId, ...ids])];
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("briefs")
    .select("title, ticket_title, ticket_state_name")
    .in("user_id", userIds)
    .eq("status", "filed")
    .is("archived_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MAX_TICKETS);
  if (error) return [];

  const tickets: PastTicket[] = ((data ?? []) as { title: string | null; ticket_title: string | null; ticket_state_name: string | null }[])
    .map((b) => ({ title: (b.ticket_title || b.title || "").trim(), group: groupOfState(b.ticket_state_name) }))
    .filter((t) => t.title);
  const value = tickets.length < MIN_TICKETS ? [] : await suggestAreas(tickets);
  cache.set(userId, { at: Date.now(), value });
  return value;
}
