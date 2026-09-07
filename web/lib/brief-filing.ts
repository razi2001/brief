import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The one place that decides "is this brief already being filed / already
 * filed?". Everything that can create a tracker ticket goes through
 * `claimFiling`, so a capture can never become two tickets.
 *
 * Why a claim at all: 'processing' means two different things - the model is
 * WRITING the ticket up (draft path) or the agent is FILING it to the tracker.
 * They look identical in the row, so the brief page used to treat a filing run
 * as "still writing", stream a draft over it, flip the brief to 'drafted' and
 * offer Export again - filing a second ticket for the same capture.
 * `filing_started_at` (0008) is what tells them apart.
 */

/** How long a filing claim is honoured before it's assumed dead (crashed
 *  worker, killed instance) and the brief may be filed again. Matches the
 *  orphan sweep in briefs-server.ts, which fails a stuck 'processing' brief. */
export const FILING_CLAIM_TTL_MS = 10 * 60 * 1000;

export type BriefPhase =
  /** The model is writing the ticket up; nothing is filed yet. */
  | "writing"
  /** A filing run holds the claim - the tracker ticket is being created. */
  | "filing"
  /** Written, not filed: the owner can edit it and export it. */
  | "draft"
  /** It has a tracker ticket. Never file it again. */
  | "filed"
  | "failed"
  | "unknown";

export type PhaseRow = {
  status: string;
  ticket_body?: string | null;
  ticket_url?: string | null;
  filing_started_at?: string | null;
};

/**
 * The brief's real state, from the row alone. `ticket_url` wins over `status`,
 * INCLUDING 'failed': a brief that has a ticket is filed even if some other
 * write left the status behind (a clobbered draft, or a run that created the
 * ticket and then died before the row updated), so a stale row can never
 * re-offer Export and never hides a ticket that exists.
 */
export function briefPhase(b: PhaseRow): BriefPhase {
  if (b.ticket_url || b.status === "filed") return "filed";
  if (b.status === "failed") return "failed";
  if (b.status === "processing" || b.status === "uploaded") {
    return b.filing_started_at || b.ticket_body ? "filing" : "writing";
  }
  if (b.status === "drafted") return "draft";
  return "unknown";
}

/**
 * Atomically take the right to file this brief. The guard lives in the WHERE
 * clause, so two concurrent requests (double-click, two tabs, a retry racing a
 * background run) can't both win: the second one matches no row.
 *
 * Refuses when the brief already has a ticket, or when another run claimed it
 * less than FILING_CLAIM_TTL_MS ago. Returns false in both cases - the caller
 * must NOT file.
 */
export async function claimFiling(
  admin: SupabaseClient,
  userId: string,
  briefId: string,
  patch: Record<string, unknown> = {},
): Promise<boolean> {
  const now = new Date();
  const stale = new Date(now.getTime() - FILING_CLAIM_TTL_MS).toISOString();
  const { data } = await admin
    .from("briefs")
    .update({
      ...patch,
      status: "processing",
      filing_started_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", briefId)
    .eq("user_id", userId)
    .is("ticket_url", null)
    .or(`filing_started_at.is.null,filing_started_at.lt.${stale}`)
    .select("id")
    .maybeSingle();
  return !!data;
}

/**
 * Give the claim back after a filing run that created NO ticket, so the owner
 * can retry immediately instead of waiting out the TTL. Guarded on
 * `ticket_url is null`: if the run did create a ticket, the row stays filed and
 * this write does nothing.
 */
export async function releaseFiling(
  admin: SupabaseClient,
  userId: string,
  briefId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await admin
    .from("briefs")
    .update({ ...patch, filing_started_at: null, updated_at: new Date().toISOString() })
    .eq("id", briefId)
    .eq("user_id", userId)
    .is("ticket_url", null);
}
