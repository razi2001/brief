import { NextRequest } from "next/server";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getLinearToken, makeLinearApi } from "@/lib/linear";
import { processBrief, type BriefInput } from "@/lib/agent/process-brief";
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

  const admin = createAdminSupabase();
  const { data: brief } = await admin.from("briefs").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!brief) return jsonCors({ error: "not found" }, { status: 404 });

  const tok = await getLinearToken(userId);
  if (!tok) return jsonCors({ error: "linear not connected" }, { status: 409 });

  await admin.from("briefs").update({ status: "processing" }).eq("id", id);
  try {
    // load brief.json + select keyframes (first/mid/last) + screenshot as data URLs
    const prefix = brief.storage_prefix as string;
    const dl = async (p: string) => {
      const { data } = await admin.storage.from("briefs").download(p);
      return data ? Buffer.from(await data.arrayBuffer()) : null;
    };
    const briefJsonBuf = await dl(`${prefix}/brief.json`);
    const json = briefJsonBuf ? JSON.parse(briefJsonBuf.toString("utf8")) : {};

    const images: BriefInput["images"] = [];
    const { data: kf } = await admin.storage.from("briefs").list(`${prefix}/keyframes`, { limit: 200 });
    const names = (kf ?? []).map((o) => o.name).sort();
    const pick = names.length ? [names[0], names[Math.floor(names.length / 2)], names[names.length - 1]] : [];
    for (const n of [...new Set(pick)]) {
      const b = await dl(`${prefix}/keyframes/${n}`);
      if (b) images.push({ name: n, dataUrl: `data:image/png;base64,${b.toString("base64")}` });
    }
    const shot = await dl(`${prefix}/screenshot.png`);
    if (shot) images.push({ name: "screenshot.png", dataUrl: `data:image/png;base64,${shot.toString("base64")}` });

    const result = await processBrief({ json, images }, makeLinearApi(tok));

    await admin.from("briefs").update({ status: "filed", ticket_url: result.ticketUrl, ticket_identifier: result.ticketIdentifier, updated_at: new Date().toISOString() }).eq("id", id);

    // delete media on success (keep the row)
    const toDelete: string[] = [`${prefix}/brief.json`, `${prefix}/recording.webm`, `${prefix}/screenshot.png`, ...names.map((n) => `${prefix}/keyframes/${n}`)];
    await admin.storage.from("briefs").remove(toDelete);

    return jsonCors(result);
  } catch (e: any) {
    await admin.from("briefs").update({ status: "failed", error: String(e?.message ?? e) }).eq("id", id);
    return jsonCors({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
