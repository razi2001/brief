// Resolve and cache org membership for everyone who already has briefs.
//
// Membership is normally resolved lazily, the first time someone loads a page.
// That leaves a cold start: the first person in a workspace to open the new
// dashboard is a leaderboard of one, so the podium hides itself until their
// colleagues happen to log in too. This warms the cache for existing users so
// an org looks like an org straight away.
//
// It does exactly what a page load would do - reads each user's tracker token
// and asks which workspace it points at - just eagerly, and writes only to
// org_members. Safe to re-run; getOrg upserts.
//
// Usage (from web/):
//   npx tsx --env-file=.env.local scripts/backfill-orgs.ts
import { createAdminSupabase } from "../lib/supabase/server";
import { getOrg } from "../lib/org-server";

async function main() {
  const admin = createAdminSupabase();

  const { data, error } = await admin.from("briefs").select("user_id");
  if (error) throw error;

  const userIds = [...new Set((data ?? []).map((r: { user_id: string }) => r.user_id))];
  console.log(`resolving org membership for ${userIds.length} users…`);

  const counts = new Map<string, number>();
  for (const userId of userIds) {
    const org = await getOrg(userId, admin);
    const label = org ? `${org.name} (${org.key})` : "— no org";
    counts.set(label, (counts.get(label) ?? 0) + 1);
    console.log(`  ${userId.slice(0, 16)}… → ${label}`);
  }

  console.log("\norgs found:");
  for (const [label, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n} × ${label}`);
  }
}

main().catch((e) => {
  console.error("backfill failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
