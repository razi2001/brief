import { requireUserId } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import BriefsFeed, { type Counts } from "@/components/BriefsFeed";
import {
  recoverOrphans,
  getTrackerContext,
  attachTicketInfo,
  BRIEF_COLUMNS,
  type BriefRow,
} from "@/lib/briefs-server";

export default async function BriefsPage() {
  const userId = await requireUserId();
  const ctx = await getTrackerContext();

  const admin = createAdminSupabase();
  await recoverOrphans(admin, userId);

  // Active (non-archived) tickets - the default view.
  const { data: activeData } = await admin
    .from("briefs")
    .select(BRIEF_COLUMNS)
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(40);
  const active = (activeData ?? []) as BriefRow[];

  // Archived tickets - fetched up front so the "Show archived" toggle is instant
  // (no refetch); hidden by default in the feed.
  const { data: archivedData } = await admin
    .from("briefs")
    .select(BRIEF_COLUMNS)
    .eq("user_id", userId)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false })
    .limit(40);
  const archived = (archivedData ?? []) as BriefRow[];

  // Only 'processing' is in-progress; 'uploaded' is an unfiled draft (hidden).
  // Counts reflect the active set only.
  const isProcessing = active.some((b) => b.status === "processing");

  const dashboardBriefs = await attachTicketInfo(
    userId,
    [...active, ...archived],
    ctx.hasLinear,
    ctx.hasJira,
    60,
    admin,
  );

  const counts: Counts = {
    filed: active.filter((b) => b.status === "filed").length,
    processing: active.filter((b) => b.status === "processing").length,
    failed: active.filter((b) => b.status === "failed").length,
  };

  return (
    <BriefsFeed briefs={dashboardBriefs} counts={counts} isProcessing={isProcessing} />
  );
}
