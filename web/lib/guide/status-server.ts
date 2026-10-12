import { createAdminSupabase } from "@/lib/supabase/server";
import { getTrackerContext } from "@/lib/briefs-server";
import { getOrg, getOrgReplaySites } from "@/lib/org-server";
import { getGuidanceContext, getUserReplay } from "@/lib/settings";
import { effectiveReplaySites } from "@/lib/replay-sites";
import type { AutoFacts } from "./progress";

/**
 * What the app already knows about the user, so the Guide can tick those
 * lessons on its own. All at once, and best-effort: anything that fails reads
 * as "not done yet" rather than breaking the page.
 */
export async function getGuideStatus(userId: string): Promise<AutoFacts> {
  const admin = createAdminSupabase();
  const safe = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);

  const [ctx, tokens, briefs, guidance, mine, org] = await Promise.all([
    safe(getTrackerContext(), null),
    safe(
      Promise.resolve(
        admin.from("extension_tokens").select("user_id", { count: "exact", head: true }).eq("user_id", userId).is("revoked_at", null),
      ).then((r) => r.count ?? 0),
      0,
    ),
    safe(
      Promise.resolve(admin.from("briefs").select("id", { count: "exact", head: true }).eq("user_id", userId).is("archived_at", null)).then(
        (r) => r.count ?? 0,
      ),
      0,
    ),
    safe(getGuidanceContext(userId), null),
    safe(getUserReplay(userId), { sites: [] as string[], mode: "inherit" as const }),
    safe(getOrg(userId), null),
  ]);
  const team = org ? await safe(getOrgReplaySites(org.key, admin), [] as string[]) : [];

  return {
    tracker: (ctx?.connected.length ?? 0) > 0,
    extension: tokens > 0,
    brief: briefs > 0,
    rules: !!guidance?.effective.trim(),
    replaySites: effectiveReplaySites({ hasTeam: !!org, mode: mine.mode, team, mine: mine.sites }).length > 0,
  };
}
