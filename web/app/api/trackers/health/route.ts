import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getTrackerContext } from "@/lib/briefs-server";
import { checkTrackerHealth } from "@/lib/tracker-health";

export const maxDuration = 60;

/**
 * Which of this user's connected trackers can actually be used: `stale` ones
 * need reconnecting, `needsWorkspace` ones are waiting on a workspace pick,
 * `unavailable` ones can't be reached from this deployment at all.
 *
 * The Connections page decides "connected" from the Clerk account record,
 * which a browser component can see but which says nothing about whether a
 * token can be vended. This is the server-side truth, fetched after the page
 * paints so a slow tracker never holds the page up.
 *
 * Costs one resolve per connected tracker, which is why it lives here and not
 * on every dashboard render.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const ctx = await getTrackerContext();
    const health = await checkTrackerHealth(userId, ctx.connected);
    return NextResponse.json(health);
  } catch {
    // Never let a health check break the page it is decorating - an unknown
    // answer renders as "no problems found", same as before this existed.
    return NextResponse.json({ stale: [], needsWorkspace: [], unavailable: [] });
  }
}
