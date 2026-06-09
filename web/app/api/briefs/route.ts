import { NextRequest, NextResponse } from "next/server";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { createAdminSupabase } from "@/lib/supabase/server";
import { detectSourceKind } from "@/lib/brief";

export async function POST(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get("authorization"));
  const userId = token ? await userIdForToken(token) : null;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json(); // { meta, files: string[] }
  const admin = createAdminSupabase();
  const sourceKind = detectSourceKind(body.meta ?? {});

  const { data: brief, error } = await admin
    .from("briefs")
    .insert({ user_id: userId, status: "uploaded", source_kind: sourceKind, storage_prefix: "pending" })
    .select("id")
    .single();
  if (error || !brief) return NextResponse.json({ error: error?.message }, { status: 500 });

  const prefix = `${userId}/${brief.id}`;
  await admin.from("briefs").update({ storage_prefix: prefix }).eq("id", brief.id);

  const uploads: Record<string, { path: string; token: string; signedUrl: string }> = {};
  for (const file of (body.files as string[]) ?? []) {
    const path = `${prefix}/${file}`;
    const { data, error: e } = await admin.storage.from("briefs").createSignedUploadUrl(path);
    if (e || !data) return NextResponse.json({ error: e?.message }, { status: 500 });
    uploads[file] = { path: data.path, token: data.token, signedUrl: data.signedUrl };
  }
  return NextResponse.json({ briefId: brief.id, uploads });
}
