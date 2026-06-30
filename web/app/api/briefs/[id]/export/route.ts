import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { processBriefById } from "@/lib/agent/run-processing";

export const maxDuration = 300;

// Export a drafted brief to the chosen tracker, filing it for real. Clerk-
// session-authed (matched by the public `/api/briefs(.*)` matcher, so it
// authenticates itself); processBriefById is scoped to the caller's own briefs,
// so only the owner can export their brief. Same-origin fetch from the brief's
// page sends the session cookie - no CORS needed.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}) as { provider?: string });
  const provider =
    body?.provider === "jira" ? "jira" : body?.provider === "linear" ? "linear" : undefined;

  const r = await processBriefById(userId, id, { provider });
  return r.ok ? Response.json(r.result) : Response.json({ error: r.error }, { status: r.status });
}
