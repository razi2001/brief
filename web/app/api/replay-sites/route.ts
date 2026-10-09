import { NextRequest } from "next/server";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { corsPreflight, jsonCors } from "@/lib/cors";
import { getOrg, getOrgReplaySites } from "@/lib/org-server";
import { getUserReplaySites } from "@/lib/settings";
import { mergeSiteLists } from "@/lib/replay-sites";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * Extension-facing: the sites to keep a replay buffer on - the org's sites plus
 * the user's own (Settings → Replay). The extension caches the list and arms
 * only matching tabs. No org just means the user's own sites alone.
 *
 * SECURITY: like everything org-scoped, the org comes from the caller's own
 * tracker tokens, never from the request.
 */
export async function GET(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get("authorization"));
  const userId = token ? await userIdForToken(token) : null;
  if (!userId) return jsonCors({ error: "unauthorized" }, { status: 401 });

  const org = await getOrg(userId).catch(() => null);
  const [team, mine] = await Promise.all([
    org ? getOrgReplaySites(org.key).catch(() => [] as string[]) : Promise.resolve([] as string[]),
    getUserReplaySites(userId),
  ]);
  return jsonCors({ sites: mergeSiteLists(team, mine), org: org?.name ?? null });
}
