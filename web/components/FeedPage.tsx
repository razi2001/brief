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
    feedQuery(admin, userId, view),
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
    <BriefsFeed
      view={view}
      briefs={dashboardBriefs}
      counts={counts}
      isProcessing={isProcessing}
      renderId={crypto.randomUUID()}
    />
  );
}

/**
 * One list's briefs. A draft being written up is "processing" like a ticket
 * being filed; only filing claims a start time (or already has a body). So
 * Drafts takes it from the first second, and Tickets never shows it.
 */
function feedQuery(admin: ReturnType<typeof createAdminSupabase>, userId: string, view: "tickets" | "drafts") {
  const q = admin.from("briefs").select(BRIEF_COLUMNS).eq("user_id", userId).is("archived_at", null);
  const scoped =
    view === "drafts"
      ? q.or("status.eq.drafted,and(status.eq.processing,filing_started_at.is.null,ticket_body.is.null)")
      : q.neq("status", "drafted").or("status.neq.processing,filing_started_at.not.is.null,ticket_body.not.is.null");
  return scoped.order("created_at", { ascending: false }).limit(40);
}
