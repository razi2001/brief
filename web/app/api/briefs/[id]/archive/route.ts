import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminSupabase } from "@/lib/supabase/server";

export const maxDuration = 60;

// Clerk-session-authed archive for a brief. Matched by the public
// `/api/briefs(.*)` matcher in proxy.ts, so the handler authenticates itself
// via the Clerk session - a same-origin fetch from the dashboard sends the
// cookie. The update is scoped to the caller's own user_id so a user can only
// archive their own briefs. Body `{ "unarchive": true }` restores instead.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}) as { unarchive?: boolean });
  const unarchive = body?.unarchive === true;

  const admin = createAdminSupabase();
  const { error } = await admin
    .from("briefs")
    .update({ archived_at: unarchive ? null : new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
