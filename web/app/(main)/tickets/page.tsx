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

  // Archived briefs are treated as deleted - never fetched, never shown.
  const { data: activeData } = await admin
    .from("briefs")
    .select(BRIEF_COLUMNS)
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(40);
  const active = (activeData ?? []) as BriefRow[];

  // Only 'processing' is in-progress; 'uploaded' is an unfiled draft (hidden).
  const isProcessing = active.some((b) => b.status === "processing");

  const dashboardBriefs = await attachTicketInfo(
    userId,
    active,
    ctx.hasLinear,
    ctx.hasJira,
    60,
    admin,
  );

  const counts: Counts = {
    filed: active.filter((b) => b.status === "filed").length,
    processing: active.filter((b) => b.status === "processing").length,
    failed: active.filter((b) => b.status === "failed").length,
    drafted: active.filter((b) => b.status === "drafted").length,
  };

  return (
    <BriefsFeed briefs={dashboardBriefs} counts={counts} isProcessing={isProcessing} />
  );
}
