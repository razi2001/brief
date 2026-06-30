import { NextRequest, after } from "next/server";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { processBriefById } from "@/lib/agent/run-processing";
import { createAdminSupabase } from "@/lib/supabase/server";
import { corsPreflight, jsonCors } from "@/lib/cors";
import { getLinearToken } from "@/lib/linear";
import { getJiraAuth } from "@/lib/jira";

export const maxDuration = 300;

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = bearerFromHeader(req.headers.get("authorization"));
  const userId = token ? await userIdForToken(token) : null;
  if (!userId) return jsonCors({ error: "unauthorized" }, { status: 401 });

  // Refuse up front when no tracker is connected, BEFORE flipping the row to
  // 'processing' - the extension gets an immediate, actionable 409 instead of a
  // brief that silently stalls and times out. The brief stays an uploaded draft
  // so it can be filed once a tracker is linked.
  const hasTracker = (await getLinearToken(userId)) ?? (await getJiraAuth(userId));
  if (!hasTracker) {
    return jsonCors(
      {
        error: "no_tracker",
        message: "No tracker connected - connect Linear or Jira in Brief Cloud first.",
      },
      { status: 409 },
    );
  }

  // Optional brief name - recordings are uploaded as a draft without one, so the
  // popup passes it now (at file time) for the dashboard to show while filing.
  // `includeVideo` is the user's "attach the recording" toggle, also only known
  // at file time (set in the popup after the draft was uploaded).
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    includeVideo?: boolean;
    transcript?: string;
    description?: string;
    extra?: Array<{ key: string; value: string }>;
    screenshots?: Array<{ file: string; description?: string; annotated?: boolean }>;
  };
  const title = (body?.title ?? "").toString().trim();
  const includeVideo = body?.includeVideo === true;
  const overrides = {
    title: title || undefined,
    includeVideo,
    transcript: typeof body?.transcript === "string" ? body.transcript : undefined,
    description: typeof body?.description === "string" ? body.description : undefined,
    extra: Array.isArray(body?.extra) ? body.extra : undefined,
    screenshots: Array.isArray(body?.screenshots) ? body.screenshots : undefined,
  };

  // Mark it queued (processing) right away, scoped to the caller, so the
  // dashboard shows it as "in progress" the instant the user lands there - then
  // respond immediately. The agent run (download → write → file) happens in the
  // background via after(), so the extension popup never waits on it.
  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs")
    .update({
      status: "processing",
      updated_at: new Date().toISOString(),
      ...(title ? { title } : {}),
    })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (!brief) return jsonCors({ error: "not found" }, { status: 404 });

  after(async () => {
    // Errors are handled inside processBriefById (it flips the row to 'failed').
    await processBriefById(userId, id, { includeVideo, overrides }).catch(() => {});
  });

  return jsonCors({ queued: true });
}
