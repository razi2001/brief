import { NextRequest } from "next/server";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { createAdminSupabase } from "@/lib/supabase/server";
import { corsPreflight, jsonCors } from "@/lib/cors";

export function OPTIONS() {
  return corsPreflight();
}

// Mint signed upload URLs for ADDITIONAL files on an existing, already-created
// brief draft. The POST /api/briefs route only ever creates a NEW brief, so a
// screenshot taken AFTER a recording's draft was uploaded had nowhere to go -
// it was dropped at file time. This lets the extension push that screenshot
// (or any late evidence) into the existing draft's storage prefix; the filing
// step picks files up straight from storage, so they then attach normally.
//
// Bearer-authed (extension), ownership-checked, CORS-enabled - same shape as
// the sibling process route.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = bearerFromHeader(req.headers.get("authorization"));
  const userId = token ? await userIdForToken(token) : null;
  if (!userId) return jsonCors({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}) as { files?: string[] });
  const files = Array.isArray(body?.files)
    ? body.files.filter((f: unknown): f is string => typeof f === "string" && f.length > 0)
    : [];
  if (!files.length) return jsonCors({ error: "no files" }, { status: 400 });

  const admin = createAdminSupabase();
  // Scope to the caller's own brief - never hand out upload URLs for another
  // account's prefix, and don't append to a draft that's already been filed.
  const { data: brief } = await admin
    .from("briefs")
    .select("id, storage_prefix, status")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!brief || !brief.storage_prefix || brief.storage_prefix === "pending") {
    return jsonCors({ error: "not found" }, { status: 404 });
  }
  if (brief.status !== "uploaded") {
    // Filing has started/finished - appending evidence now would race the agent
    // or land on a brief whose media was already consumed and deleted.
    return jsonCors({ error: "not a draft" }, { status: 409 });
  }

  const prefix = brief.storage_prefix as string;
  const uploads: Record<string, { path: string; token: string; signedUrl: string }> = {};
  for (const file of files) {
    const path = `${prefix}/${file}`;
    // upsert: a screenshot may have been bundled into the draft already (the
    // screenshot-first ordering), so overwriting the same path must be allowed.
    const { data, error } = await admin.storage
      .from("briefs")
      .createSignedUploadUrl(path, { upsert: true });
    if (error || !data) return jsonCors({ error: error?.message }, { status: 500 });
    uploads[file] = { path: data.path, token: data.token, signedUrl: data.signedUrl };
  }
  return jsonCors({ briefId: brief.id, uploads });
}
