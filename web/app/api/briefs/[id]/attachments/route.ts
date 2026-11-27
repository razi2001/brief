import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { RECORDING_NAMES, isRecordingName } from "@/lib/brief";
import { briefPhase } from "@/lib/brief-filing";
import { isUploadPath } from "@/lib/draft-uploads";

/**
 * The owner adds images and a video to a draft from its page.
 *
 * POST  { paths }      signed upload URLs for those paths in the draft's folder
 *                      (the browser PUTs the bytes straight to storage, so a
 *                      video never goes through this server's body limit).
 * PATCH { recording }  after a video's upload: make it THE draft's recording
 *                      and mark it attached, so export files it on the ticket
 *                      (and doesn't delete it as an unwanted recording).
 *
 * Clerk-session-authed, owner only, drafts only.
 */

type Owned = { error: Response } | { admin: ReturnType<typeof createAdminSupabase>; prefix: string };

async function ownDraft(id: string): Promise<Owned> {
  const { userId } = await auth();
  if (!userId) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs")
    .select("id, status, storage_prefix, ticket_url, ticket_body, filing_started_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!brief || !brief.storage_prefix || brief.storage_prefix === "pending") {
    return { error: Response.json({ error: "not found" }, { status: 404 }) };
  }
  if (briefPhase(brief) !== "draft") {
    return { error: Response.json({ error: "not a draft" }, { status: 409 }) };
  }
  return { admin, prefix: brief.storage_prefix as string };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { paths?: unknown };
  const paths = Array.isArray(body.paths) ? body.paths : [];
  if (!paths.length || paths.length > 20 || !paths.every(isUploadPath)) {
    return Response.json({ error: "bad paths" }, { status: 400 });
  }
  const own = await ownDraft(id);
  if ("error" in own) return own.error;

  const uploads: Record<string, string> = {};
  for (const p of paths as string[]) {
    const { data, error } = await own.admin.storage.from("briefs").createSignedUploadUrl(`${own.prefix}/${p}`, { upsert: true });
    if (error || !data) return Response.json({ error: error?.message ?? "no upload url" }, { status: 500 });
    uploads[p] = data.signedUrl;
  }
  return Response.json({ uploads });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { recording?: unknown };
  if (!isRecordingName(body.recording)) return Response.json({ error: "bad recording" }, { status: 400 });
  const recording = body.recording;
  const own = await ownDraft(id);
  if ("error" in own) return own.error;
  const bucket = own.admin.storage.from("briefs");

  // One recording per brief: a new one replaces any other container's.
  const others = RECORDING_NAMES.filter((n) => n !== recording).map((n) => `${own.prefix}/${n}`);
  await bucket.remove(others);

  // brief.json says which recording is the one and that it goes on the ticket.
  // A blank draft has none yet: start one.
  let json: Record<string, unknown> = {};
  const { data: blob } = await bucket.download(`${own.prefix}/brief.json`);
  if (blob) {
    try {
      json = JSON.parse(await blob.text()) as Record<string, unknown>;
    } catch {
      json = {};
    }
  }
  const prior = (json.recording && typeof json.recording === "object" ? json.recording : {}) as Record<string, unknown>;
  // A blank draft has no page of its own, so the video is all there is: mark it
  // uploaded, the way a video uploaded from the extension is.
  json.recording = { ...prior, file: recording, ...(blob ? {} : { source: "upload" }) };
  json.hasRecording = true;
  json.includeVideo = true;
  const { error } = await bucket.upload(`${own.prefix}/brief.json`, JSON.stringify(json, null, 2), {
    contentType: "application/json",
    upsert: true,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
