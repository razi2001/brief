import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminSupabase } from "@/lib/supabase/server";

export const maxDuration = 60;

// Permanently delete a brief: removes any remaining storage media and the row.
// Clerk-session-authed (same-origin fetch from the dashboard sends the cookie),
// scoped to the caller's own user_id so a user can only delete their own briefs.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs")
    .select("id, storage_prefix")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!brief) return NextResponse.json({ ok: true }); // already gone

  // Best-effort media cleanup (filed briefs have already had theirs removed).
  try {
    const prefix = brief.storage_prefix as string;
    if (prefix && prefix !== "pending") {
      const { data: kf } = await admin.storage.from("briefs").list(`${prefix}/keyframes`, { limit: 200 });
      const paths = [
        `${prefix}/brief.json`,
        `${prefix}/recording.webm`,
        `${prefix}/screenshot.png`,
        ...(kf ?? []).map((o) => `${prefix}/keyframes/${o.name}`),
      ];
      await admin.storage.from("briefs").remove(paths);
    }
  } catch {
    // ignore - deleting the row is what matters
  }

  const { error } = await admin.from("briefs").delete().eq("id", id).eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
