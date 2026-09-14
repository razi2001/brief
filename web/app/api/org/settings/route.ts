import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getOrg, getOrgMemberIds, setOrgSettings } from "@/lib/org-server";

export const maxDuration = 60;

// Same ceiling as the personal guidance in /api/settings.
const MAX_GUIDANCE = 4000;

/**
 * Write the ticket guidance shared by everyone in the caller's org.
 *
 * SECURITY: the org is resolved from the caller's own live tracker token, never
 * taken from the request. There is deliberately no `orgKey` parameter - if
 * there were, anyone could rewrite any org's filing rules by naming it.
 *
 * Anyone in the org may edit it; the confirmation dialog in the UI is what
 * stops an accidental change. The trackers expose no dependable admin/role
 * signal, so this is a speed bump rather than a permission - see the design
 * doc for what gating it properly would take.
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
  if (!("ticketGuidance" in body)) {
    return NextResponse.json({ error: "ticketGuidance is required" }, { status: 400 });
  }
  const guidance = String(body.ticketGuidance ?? "")
    .trim()
    .slice(0, MAX_GUIDANCE);

  const org = await getOrg(userId);
  if (!org) {
    return NextResponse.json(
      { error: "Connect a tracker to share preferences with your team." },
      { status: 400 },
    );
  }

  // Stored alongside the guidance so "last changed by X" needs no Clerk call.
  let name = "someone";
  try {
    const user = await currentUser();
    name =
      user?.firstName ??
      user?.username ??
      user?.primaryEmailAddress?.emailAddress?.split("@")[0] ??
      "someone";
  } catch {
    /* an unknown author is not worth failing the save over */
  }

  try {
    await setOrgSettings(org.key, guidance, { userId, name });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const members = await getOrgMemberIds(org.key);
  return NextResponse.json({ ok: true, members: members.length, updatedByName: name });
}
