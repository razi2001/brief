import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getOrg, setOrgReplaySites } from "@/lib/org-server";
import { cleanSiteList } from "@/lib/replay-sites";

/**
 * Replace the org's instant-replay sites (Settings). Same trust model as the
 * org ticket guidance: the org is resolved from the caller's own tracker token,
 * never named in the request, and anyone in the org may edit it.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!Array.isArray(body.sites)) return NextResponse.json({ error: "sites must be a list" }, { status: 400 });
  const sites = cleanSiteList(body.sites);

  const org = await getOrg(userId);
  if (!org) {
    return NextResponse.json({ error: "Connect a tracker to set sites for your team." }, { status: 400 });
  }

  let name = "someone";
  try {
    const user = await currentUser();
    name = user?.firstName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress?.split("@")[0] ?? "someone";
  } catch {
    /* an unknown author is not worth failing the save over */
  }

  try {
    await setOrgReplaySites(org.key, sites, { userId, name });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  return NextResponse.json({ ok: true, sites });
}
