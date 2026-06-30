import { NextRequest, after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { processBriefById } from "@/lib/agent/run-processing";
import { createAdminSupabase } from "@/lib/supabase/server";

export const maxDuration = 300;

// Export a drafted brief to the chosen tracker. Clerk-session-authed (matched by
// the public `/api/briefs(.*)` matcher); processBriefById is scoped to the
// caller's own briefs, so only the owner can export.
//
// The ticket is ALREADY written, so this is fast: it files the stored title/body
// verbatim and only routes + attaches evidence (no re-transcription, no keyframe
// vision). It marks the brief 'processing' and files in the background so the
// page can show a "Filing…" state immediately; a failed export reverts the brief
// to 'drafted' so the draft is never lost.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { provider?: string };
  const provider =
    body?.provider === "jira" ? "jira" : body?.provider === "linear" ? "linear" : undefined;

  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (!brief) return Response.json({ error: "not found" }, { status: 404 });

  after(async () => {
    try {
      const r = await processBriefById(userId, id, { provider, useExistingContent: true });
      // A failed export must not destroy the draft - put it back to 'drafted'
      // (processBriefById flips it to 'failed' on error) so the owner can retry.
      if (!r.ok) {
        await admin
          .from("briefs")
          .update({ status: "drafted", error: null, updated_at: new Date().toISOString() })
          .eq("id", id)
          .eq("user_id", userId);
      }
    } catch {
      await admin
        .from("briefs")
        .update({ status: "drafted", error: null, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", userId);
    }
  });

  return Response.json({ queued: true });
}
