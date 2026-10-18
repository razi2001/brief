import { NextRequest } from "next/server";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { createAdminSupabase } from "@/lib/supabase/server";
import { detectSourceKind } from "@/lib/brief";
import { corsPreflight, jsonCors } from "@/lib/cors";
import { isShareId, isUniqueViolation } from "@/lib/share-id";

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get("authorization"));
  const userId = token ? await userIdForToken(token) : null;
  if (!userId) return jsonCors({ error: "unauthorized" }, { status: 401 });

  const body = await req.json(); // { meta, files: string[], shareId? }
  const admin = createAdminSupabase();
  const sourceKind = detectSourceKind(body.meta ?? {});
  // User-given brief name, shown on the dashboard while the ticket is filing.
  const title = (body.meta?.title ?? "").toString().trim() || null;
  // Public link and Fix prompt copied /b/<shareId> before uploading: the link is live
  // from this row on (it reads as being written until the draft lands).
  const shareId = isShareId(body.shareId) ? body.shareId : null;

  const row = { user_id: userId, status: "uploaded", source_kind: sourceKind, storage_prefix: "pending", title };
  const insert = (r: typeof row & { share_id?: string }) => admin.from("briefs").insert(r).select("id").single();
  let { data: brief, error } = await insert(shareId ? { ...row, share_id: shareId } : row);
  if (shareId && isUniqueViolation(error)) {
    // A retry after a failed upload: the first attempt's row, never finished,
    // holds the link. It moves to this one.
    await admin
      .from("briefs")
      .update({ share_id: null })
      .eq("share_id", shareId)
      .eq("user_id", userId)
      .eq("status", "uploaded");
    ({ data: brief, error } = await insert({ ...row, share_id: shareId }));
    // Someone else's: this brief gets its own when it's written.
    if (isUniqueViolation(error)) ({ data: brief, error } = await insert(row));
  }
  if (error || !brief) return jsonCors({ error: error?.message }, { status: 500 });

  const prefix = `${userId}/${brief.id}`;
  await admin.from("briefs").update({ storage_prefix: prefix }).eq("id", brief.id);

  const uploads: Record<string, { path: string; token: string; signedUrl: string }> = {};
  for (const file of (body.files as string[]) ?? []) {
    const path = `${prefix}/${file}`;
    const { data, error: e } = await admin.storage.from("briefs").createSignedUploadUrl(path);
    if (e || !data) return jsonCors({ error: e?.message }, { status: 500 });
    uploads[file] = { path: data.path, token: data.token, signedUrl: data.signedUrl };
  }
  return jsonCors({ briefId: brief.id, uploads });
}
