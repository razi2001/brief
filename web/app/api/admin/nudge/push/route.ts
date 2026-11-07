import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isAdmin } from "@/lib/admin-server";
import { parseTargets } from "@/lib/nudge";
import { createPush } from "@/lib/nudge-server";

/**
 * The owner shows the reminder now: `{ userIds }` for these people, `{}` for
 * everyone. It opens in each browser on its next page load once the extension
 * checks in.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const targets = parseTargets(await req.json().catch(() => ({})));
  if (targets === undefined) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const push = await createPush(targets);
  if (!push) return NextResponse.json({ error: "could not save" }, { status: 500 });
  return NextResponse.json({ ok: true, at: push.at });
}
