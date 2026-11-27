import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { stopFiling } from "@/lib/brief-filing";
import { createAdminSupabase } from "@/lib/supabase/server";
import { corsPreflight, jsonCors } from "@/lib/cors";
import { track } from "@/lib/events";

// Stop a ticket that is being filed, before it reaches the tracker. The brief
// goes back to a draft (an Export being filed) or to an unfiled capture, which
// the extension takes back into its popup.
// Called from the brief page (Clerk cookie) and from the extension (bearer).
// /api/briefs(.*) is public in proxy.ts, so this route authenticates itself.

async function caller(req: NextRequest): Promise<string | null> {
  const token = bearerFromHeader(req.headers.get("authorization"));
  if (token) return userIdForToken(token);
  return (await auth()).userId ?? null;
}

export function OPTIONS() {
  return corsPreflight();
}

/**
 * Where the brief stands, for the extension holding a copy of it:
 * `filing` (Stop still works), `stopped` (Stop was pressed, on the web or
 * here), or `done` (filed, failed or gone - the copy can go).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await caller(req);
  if (!userId) return jsonCors({ error: "unauthorized" }, { status: 401 });
  const { data } = await createAdminSupabase()
    .from("briefs")
    .select("status, ticket_url, filing_started_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  const state = !data || data.ticket_url
    ? "done"
    : data.status === "processing" && data.filing_started_at
      ? "filing"
      : data.status === "uploaded" && !data.filing_started_at
        ? "stopped"
        : "done";
  return jsonCors({ state });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await caller(req);
  if (!userId) return jsonCors({ error: "unauthorized" }, { status: 401 });
  const back = await stopFiling(createAdminSupabase(), userId, id);
  if (!back) return jsonCors({ error: "not_filing" }, { status: 409 });
  track(userId, "brief.stopped");
  return jsonCors({ stopped: true, back });
}
