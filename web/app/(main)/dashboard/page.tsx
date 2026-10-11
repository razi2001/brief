import { after } from "next/server";
import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import AutoRefresh from "@/components/AutoRefresh";
import RefreshButton from "@/components/RefreshButton";
import DashboardView from "@/components/DashboardView";
import { providerName } from "@/lib/trackers/registry";
import {
  recoverOrphans,
  getTrackerContext,
  BRIEF_COLUMNS,
  type BriefRow,
} from "@/lib/briefs-server";
import { TITLES } from "@/lib/podium";
import {
  type PodiumEntry,
  getLeaderboards,
  getOrg,
  getOrgRoi,
  getRoiFor,
  warmOrgMemberships,
} from "@/lib/org-server";

export default async function Dashboard() {
  const userId = await requireUserId();
  const admin = createAdminSupabase();

  // WAVE 1 - everything that depends only on the user id, together.
  //
  // These used to await one after another, and with each round trip costing
  // 100-400ms the page spent well over a second doing nothing but waiting in
  // a line it never needed to stand in. Nothing here needs anything else here.
  const [ctx, briefs, org] = await Promise.all([
    getTrackerContext(),
    admin
      .from("briefs")
      .select(BRIEF_COLUMNS)
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(500),
    getOrg(userId, admin),
  ]);
  const list = (briefs.data ?? []) as BriefRow[];

  // Orphan recovery only fixes rows for the NEXT render, so it has no business
  // holding this one up.
  after(() => recoverOrphans(admin, userId));

  const filed = list.filter((b) => b.status === "filed");
  // 'uploaded' = unfiled draft (managed in the extension) - not "in progress".
  const processing = list.filter((b) => b.status === "processing");

  const weekAgo = new Date().getTime() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = filed.filter(
    (b) => b.created_at && new Date(b.created_at).getTime() >= weekAgo,
  ).length;

  // WAVE 2 - the leaderboard and the headline numbers, together. Best-effort:
  // no org, or an aggregate that fails, simply means less on the page.
  const [boards, roi] = await Promise.all([
    org ? getLeaderboards(org.key, userId, admin) : { month: [], all: [] },
    org ? getOrgRoi(org.key, admin) : getRoiFor([userId], admin),
  ]);

  if (org) after(() => warmOrgMemberships(admin));

  // The leaderboard shows from the first person: with no team (or nobody on
  // the board yet) you stand on it alone, and the open places invite others.
  const monthAgo = new Date().getTime() - 30 * 24 * 60 * 60 * 1000;
  const me = (n: number): PodiumEntry => ({
    userId,
    rank: 1,
    filed: n,
    title: TITLES.first,
    name: ctx.user?.fullName || ctx.user?.firstName || "You",
    imageUrl: ctx.user?.imageUrl,
    isYou: true,
  });
  const shownBoards = {
    month: boards.month.length
      ? boards.month
      : [me(filed.filter((b) => b.created_at && new Date(b.created_at).getTime() >= monthAgo).length)],
    all: boards.all.length ? boards.all : [me(filed.length)],
  };

  if (!!ctx.user && !ctx.onboarded && filed.length === 0) redirect("/welcome");

  // the extension is set up once it holds a live pairing token
  const { count: tokens } = await admin
    .from("extension_tokens")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("revoked_at", null);

  return (
    <>
      {/* Live status: a fast poll while anything is filing, a slow one
          otherwise, a refresh on tab focus; the button for impatient moments. */}
      <div className="mx-auto -mb-8 flex w-full max-w-[960px] items-center justify-end gap-2">
        <AutoRefresh active={processing.length > 0} />
        <RefreshButton />
      </div>
      <DashboardView
        hasTracker={ctx.connected.length > 0}
        trackerName={ctx.connected[0] ? providerName(ctx.connected[0]) : undefined}
        extensionPaired={(tokens ?? 0) > 0}
        filed={filed.length}
        thisWeek={thisWeek}
        org={org}
        roi={roi}
        boards={shownBoards}
      />
    </>
  );
}
