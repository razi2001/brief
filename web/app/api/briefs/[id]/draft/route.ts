import { NextRequest, after } from "next/server";
import { randomBytes } from "crypto";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { mergeBriefOverrides } from "@/lib/agent/overrides";
import { briefPhase } from "@/lib/brief-filing";
import { createAdminSupabase } from "@/lib/supabase/server";
import { corsPreflight, jsonCors } from "@/lib/cors";
import { draftBriefById } from "@/lib/agent/run-processing";
import { runDraftJob } from "@/lib/agent/draft-jobs";

export const maxDuration = 300;

export function OPTIONS() {
  return corsPreflight();
}

// Prepare a brief to be written up as a DRAFT (no tracker, no filing). Marks it
// 'processing', merges the popup's edits into the stored brief.json, and mints +
// returns the share token so the extension can open the brief's page. The actual
// writing is STREAMED live from the brief page (POST /api/briefs/:id/stream),
// which persists the finished draft (with a background fallback if the client
// disconnects). Bearer-authed (extension).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = bearerFromHeader(req.headers.get("authorization"));
  const userId = token ? await userIdForToken(token) : null;
  if (!userId) return jsonCors({ error: "unauthorized" }, { status: 401 });

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
    .select("id, share_id, storage_prefix, status, ticket_body, ticket_url, filing_started_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!existing) return jsonCors({ error: "not found" }, { status: 404 });

  // Never re-draft a capture that is already filed or on its way to a tracker -
  // turning it back into a draft is what re-offered Export and produced a
  // second ticket.
  const phase = briefPhase(existing);
  if (phase === "filed" || phase === "filing") {
    return jsonCors(
      {
        error: "already_filed",
        message: "This capture already has a ticket - open it in Brief.",
        shareId: existing.share_id,
      },
      { status: 409 },
    );
  }

  // Merge the popup's edits into the stored brief.json so the streaming write
  // (which reads brief.json fresh) uses them - the recording path uploads
  // brief.json at stop time, before those edits.
  const prefix = existing.storage_prefix as string;
  try {
    const { data: blob } = await admin.storage.from("briefs").download(`${prefix}/brief.json`);
    const raw = blob ? JSON.parse(await blob.text()) : {};
    const merged = mergeBriefOverrides(raw, overrides);
    await admin.storage
      .from("briefs")
      .upload(`${prefix}/brief.json`, JSON.stringify(merged, null, 2), {
        contentType: "application/json",
        upsert: true,
      });
  } catch {
    /* best-effort: the stream still writes from whatever brief.json exists */
  }

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

  // Write it now, in the background. The draft used to be written only when
  // its page was opened (the page streamed it) - fine when saving a draft
  // opened that page, but the extension hands drafts off now and opens
  // nothing, so a draft sat "writing" until someone happened to look.
  after(async () => {
    await runDraftJob(id, () => draftBriefById(userId, id));
  });

  return jsonCors({ queued: true, shareId });
}
