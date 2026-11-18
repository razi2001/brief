import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { parsePing } from "@/lib/telemetry";

/**
 * Receives self-hosted instances' daily heartbeat (lib/telemetry). Only the
 * hosted instance listens: BRIEF_TELEMETRY_RECEIVER=on. One row per instance,
 * overwritten each day; nothing else from the request is kept (not the IP).
 */
export async function POST(req: Request) {
  if (process.env.BRIEF_TELEMETRY_RECEIVER !== "on") return new NextResponse(null, { status: 404 });
  const ping = parsePing(await req.json().catch(() => null));
  if (!ping) return NextResponse.json({ error: "bad ping" }, { status: 400 });
  const { error } = await createAdminSupabase()
    .from("instance_pings")
    .upsert({ ...ping, last_seen: new Date().toISOString() }, { onConflict: "instance" });
  if (error) console.warn("[telemetry] not stored:", error.message);
  return new NextResponse(null, { status: 204 });
}
