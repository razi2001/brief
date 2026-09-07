import { NextRequest, after } from "next/server";
import { randomBytes } from "crypto";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { processBriefById } from "@/lib/agent/run-processing";
import { claimFiling } from "@/lib/brief-filing";
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

  // Mark it queued (processing) right away, scoped to the caller, and mint the
  // share token NOW (preserving an existing one) so the extension can open the
  // brief page immediately - it shows the "writing…" state and resolves into the
  // filed ticket. The agent run happens in the background via after().
  const admin = createAdminSupabase();
  const { data: existing } = await admin
    .from("briefs")
    .select("id, share_id, ticket_url")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!existing) return jsonCors({ error: "not found" }, { status: 404 });

  const shareId = (existing.share_id as string | null) || randomBytes(9).toString("base64url");
  // Take the filing claim in the same write that marks it queued. It fails when
  // this capture already has a ticket, or another run is filing it - so a
  // re-submit can never file a second ticket for the same brief.
  const claimed = await claimFiling(admin, userId, id, {
    share_id: shareId,
    ...(title ? { title } : {}),
  });
  if (!claimed) {
    return jsonCors(
      {
        error: "already_filed",
        message: existing.ticket_url
          ? "This capture was already filed - open it in Brief."
          : "This capture is being filed right now.",
        shareId,
      },
      { status: 409 },
    );
  }

  after(async () => {
    // Errors are handled inside processBriefById (it flips the row to 'failed').
    await processBriefById(userId, id, { includeVideo, overrides }).catch(() => {});
  });

  return jsonCors({ queued: true, shareId });
}
