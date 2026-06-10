import { UserButton } from "@clerk/nextjs";
import { requireUserId } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import AppShell from "@/components/AppShell";
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

  const { data } = await admin
    .from("briefs")
    .select(BRIEF_COLUMNS)
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(40);
  const list = (data ?? []) as BriefRow[];

  const isProcessing = list.some(
    (b) => b.status === "uploaded" || b.status === "processing",
  );

  const dashboardBriefs = await attachTicketInfo(userId, list, ctx.hasLinear, ctx.hasJira);

  const counts: Counts = {
    filed: list.filter((b) => b.status === "filed").length,
    processing: list.filter((b) => b.status === "processing" || b.status === "uploaded").length,
    failed: list.filter((b) => b.status === "failed").length,
  };

  return (
    <AppShell headerRight={<UserButton />}>
      <BriefsFeed briefs={dashboardBriefs} counts={counts} isProcessing={isProcessing} />
    </AppShell>
  );
}
