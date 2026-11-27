import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { stopFiling } from "@/lib/brief-filing";
import { createAdminSupabase } from "@/lib/supabase/server";
import { track } from "@/lib/events";

// Stop a ticket that is being filed, before it reaches the tracker. The brief
// goes back to a draft (an Export being filed) or to an unfiled capture.
// Called from the brief page. /api/briefs(.*) is public in proxy.ts, so this
// route checks the Clerk session itself.

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const back = await stopFiling(createAdminSupabase(), userId, id);
  if (!back) return NextResponse.json({ error: "not_filing" }, { status: 409 });
  track(userId, "brief.stopped");
  return NextResponse.json({ stopped: true, back });
}
