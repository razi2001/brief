import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { processBriefById } from "@/lib/agent/run-processing";

export const maxDuration = 300;

// Clerk-session-authed retry for a failed brief. This path is matched by the
// public `/api/briefs(.*)` matcher in proxy.ts, so the handler authenticates
// itself via the Clerk session — a same-origin fetch from the dashboard sends
// the cookie. CORS is unnecessary (same-origin) so it's omitted.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const r = await processBriefById(userId, id);
  return r.ok ? Response.json(r.result) : Response.json({ error: r.error }, { status: r.status });
}
