import { NextRequest } from "next/server";
import { bearerFromHeader, lastBriefAt, userIdForToken } from "@/lib/extauth";
import { corsPreflight, jsonCors } from "@/lib/cors";
import { getOrg, getOrgReplaySites } from "@/lib/org-server";
import { getUserReplay } from "@/lib/settings";
import { effectiveReplaySites } from "@/lib/replay-sites";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * Extension-facing: the sites to keep a replay buffer on - the team's, or the
 * user's own when they chose "Use my own" (Settings → Replay, like Ticket
 * rules). No org: the user's own. The extension caches the list and arms only
 * matching tabs.
 *
 * SECURITY: like everything org-scoped, the org comes from the caller's own
 * tracker tokens, never from the request.
 *
 * `lastBriefAt`: when this user last made a brief (or paired, with none), for
 * the extension's reminder popup. It rides on this request because the
 * extension already makes it on page loads.
 */
export async function GET(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get("authorization"));
  const userId = token ? await userIdForToken(token) : null;
  if (!token || !userId) return jsonCors({ error: "unauthorized" }, { status: 401 });

  const org = await getOrg(userId).catch(() => null);
  const [team, me, last] = await Promise.all([
    org ? getOrgReplaySites(org.key).catch(() => [] as string[]) : Promise.resolve([] as string[]),
    getUserReplay(userId),
    lastBriefAt(userId, token).catch(() => null),
  ]);
  // one list applies: the team's or the user's own (Settings → Replay)
  const sites = effectiveReplaySites({ hasTeam: !!org, mode: me.mode, team, mine: me.sites });
  return jsonCors({ sites, org: org?.name ?? null, mode: org ? me.mode : null, lastBriefAt: last });
}
