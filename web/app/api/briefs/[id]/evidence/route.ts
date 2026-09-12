import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { isRecordingName } from "@/lib/brief";

/**
 * Owner control over a brief's evidence: remove a screenshot or the recording
 * from the brief page. Deletes the object from storage and (best-effort)
 * drops its reference from brief.json so a later re-file doesn't point the
 * agent at a file that no longer exists.
 */

// Only the exact evidence objects a brief can own - never arbitrary paths.
const ALLOWED = /^(screenshots\/[A-Za-z0-9._-]+\.png|screenshot\.png|recording\.(webm|mp4|mov))$/;

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { path?: string };
  const path = (body?.path ?? "").toString();
  if (!ALLOWED.test(path)) return Response.json({ error: "bad path" }, { status: 400 });

  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs")
    .select("id, storage_prefix")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!brief) return Response.json({ error: "not found" }, { status: 404 });

  const prefix = brief.storage_prefix as string;
  const { error } = await admin.storage.from("briefs").remove([`${prefix}/${path}`]);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Keep brief.json honest so a later re-file doesn't reference the removed
  // asset. Best-effort: the file may predate these fields or not exist.
  try {
    const { data: blob } = await admin.storage.from("briefs").download(`${prefix}/brief.json`);
    if (blob) {
      const json = JSON.parse(await blob.text()) as Record<string, unknown>;
      if (isRecordingName(path)) {
        json.hasRecording = false;
        json.includeVideo = false;
      } else if (Array.isArray(json.screenshots)) {
        json.screenshots = (json.screenshots as Array<{ file?: string }>).filter((s) => s?.file !== path);
      }
      await admin.storage.from("briefs").upload(`${prefix}/brief.json`, JSON.stringify(json, null, 2), {
        contentType: "application/json",
        upsert: true,
      });
    }
  } catch {
    /* reference cleanup is best-effort */
  }

  return Response.json({ ok: true });
}
