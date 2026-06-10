import { NextRequest, after } from "next/server";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { processBriefById } from "@/lib/agent/run-processing";
import { createAdminSupabase } from "@/lib/supabase/server";
import { corsPreflight, jsonCors } from "@/lib/cors";

export const maxDuration = 300;

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = bearerFromHeader(req.headers.get("authorization"));
  const userId = token ? await userIdForToken(token) : null;
  if (!userId) return jsonCors({ error: "unauthorized" }, { status: 401 });

  // Mark it queued (processing) right away, scoped to the caller, so the
  // dashboard shows it as "in progress" the instant the user lands there — then
  // respond immediately. The agent run (download → write → file) happens in the
  // background via after(), so the extension popup never waits on it.
  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (!brief) return jsonCors({ error: "not found" }, { status: 404 });

  after(async () => {
    // Errors are handled inside processBriefById (it flips the row to 'failed').
    await processBriefById(userId, id).catch(() => {});
  });

  return jsonCors({ queued: true });
}
