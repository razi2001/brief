import { NextRequest, after } from "next/server";
import { randomBytes } from "crypto";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { draftBriefById } from "@/lib/agent/run-processing";
import { createAdminSupabase } from "@/lib/supabase/server";
import { corsPreflight, jsonCors } from "@/lib/cors";

export const maxDuration = 300;

export function OPTIONS() {
  return corsPreflight();
}

// Write a brief up as a DRAFT (no tracker, no filing). Mirror of the process
// route (same override payload), minus the tracker requirement: a draft just
// needs the agent to write the ticket. The owner exports it to Linear/Jira later
// from the brief's page.
//
// Bearer-authed (extension). Mints the share token NOW and returns it, so the
// extension can open the brief's page immediately - the page shows a "writing
// this up" state and resolves into the finished ticket. The write runs in the
// background via after().
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = bearerFromHeader(req.headers.get("authorization"));
  const userId = token ? await userIdForToken(token) : null;
  if (!userId) return jsonCors({ error: "unauthorized" }, { status: 401 });

  // The popup's edits made after upload (same shape as the process route).
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    includeVideo?: boolean;
    transcript?: string;
    description?: string;
    extra?: Array<{ key: string; value: string }>;
    screenshots?: Array<{ file: string; description?: string; annotated?: boolean }>;
  };
  const title = (body?.title ?? "").toString().trim();
  const overrides = {
    title: title || undefined,
    includeVideo: body?.includeVideo === true,
    transcript: typeof body?.transcript === "string" ? body.transcript : undefined,
    description: typeof body?.description === "string" ? body.description : undefined,
    extra: Array.isArray(body?.extra) ? body.extra : undefined,
    screenshots: Array.isArray(body?.screenshots) ? body.screenshots : undefined,
  };

  const admin = createAdminSupabase();
  const { data: existing } = await admin
    .from("briefs")
    .select("id, share_id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!existing) return jsonCors({ error: "not found" }, { status: 404 });

  // Reuse an existing token (idempotent re-draft) or mint one now.
  const shareId = (existing.share_id as string | null) || randomBytes(9).toString("base64url");
  await admin
    .from("briefs")
    .update({
      status: "processing",
      updated_at: new Date().toISOString(),
      share_id: shareId,
      ...(title ? { title } : {}),
    })
    .eq("id", id)
    .eq("user_id", userId);

  after(async () => {
    // Errors are handled inside draftBriefById (it flips the row to 'failed').
    await draftBriefById(userId, id, { overrides }).catch(() => {});
  });

  return jsonCors({ queued: true, shareId });
}
