import { after } from "next/server";
import { requireUserId } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import BriefsFeed, { type Counts } from "@/components/BriefsFeed";
import {
  recoverOrphans,
  getTrackerContext,
  attachTicketInfoFast,
  BRIEF_COLUMNS,
  type BriefRow,
} from "@/lib/briefs-server";

/**
 * The list behind Tickets and Drafts: the same feed, split by whether the
 * brief has become a ticket. Drafts are written up but never filed; Tickets is
 * everything filed, filing or that didn't file.
 */
export default async function FeedPage({ view }: { view: "tickets" | "drafts" }) {
  const userId = await requireUserId();
  const admin = createAdminSupabase();

  // Fixing stuck rows only matters for the NEXT render; don't hold this one.
  after(() => recoverOrphans(admin, userId));

  // The list and (for Tickets) the connected trackers, together. Drafts have
  // no tracker ticket, so they never ask Clerk or a tracker anything.
  const [ctx, { data: activeData }] = await Promise.all([
    view === "tickets" ? getTrackerContext() : Promise.resolve(null),
    // Archived briefs are treated as deleted - never fetched, never shown.
    admin
      .from("briefs")
      .select(BRIEF_COLUMNS)
      .eq("user_id", userId)
      .is("archived_at", null)
      .filter("status", view === "drafts" ? "eq" : "neq", "drafted")
      .order("created_at", { ascending: false })
      .limit(40),
  ]);
  const active = (activeData ?? []) as BriefRow[];

  // Only 'processing' is in-progress; 'uploaded' is an unfiled draft (hidden).
  const isProcessing = active.some((b) => b.status === "processing");

  const dashboardBriefs = await attachTicketInfoFast(userId, active, ctx?.connected ?? [], admin);

  const counts: Counts = {
    filed: active.filter((b) => b.status === "filed").length,
    processing: active.filter((b) => b.status === "processing").length,
    failed: active.filter((b) => b.status === "failed").length,
    drafted: active.filter((b) => b.status === "drafted").length,
  };

  return (
    <BriefsFeed view={view} briefs={dashboardBriefs} counts={counts} isProcessing={isProcessing} />
  );
}
