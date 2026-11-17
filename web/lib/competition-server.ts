import { currentUser } from "@clerk/nextjs/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import { TITLES } from "@/lib/podium";
import { type PodiumEntry, getLeaderboards, getOrg } from "@/lib/org-server";

/**
 * The team's monthly Quality competition, the one everyone is always in: its
 * board this month and of all time. With no team (or nobody on it yet) you
 * stand on it alone, as on Tickets. Never throws: it is an extra on its page.
 */
export async function monthlyCompetition(
  userId: string,
  db?: SupabaseClient,
): Promise<{ month: PodiumEntry[]; all: PodiumEntry[]; orgName: string | null }> {
  const admin = db ?? createAdminSupabase();
  const org = await getOrg(userId, admin).catch(() => null);
  const boards = org ? await getLeaderboards(org.key, userId, admin).catch(() => ({ month: [], all: [] })) : { month: [], all: [] };
  if (boards.month.length && boards.all.length) return { ...boards, orgName: org?.name ?? null };

  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const filed = () =>
    admin.from("briefs").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "filed").is("archived_at", null);
  const [user, inMonth, ever] = await Promise.all([
    currentUser().catch(() => null),
    filed().gte("created_at", monthAgo).then((r) => r.count ?? 0, () => 0),
    filed().then((r) => r.count ?? 0, () => 0),
  ]);
  const me = (n: number): PodiumEntry => ({
    userId,
    rank: 1,
    filed: n,
    title: TITLES.first,
    name: user?.fullName || user?.firstName || "You",
    imageUrl: user?.imageUrl,
    isYou: true,
  });
  return {
    month: boards.month.length ? boards.month : [me(inMonth)],
    all: boards.all.length ? boards.all : [me(ever)],
    orgName: org?.name ?? null,
  };
}
