import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminSupabase } from "@/lib/supabase/server";

// Edit a brief's title and/or body. Clerk-session-authed (matched by the public
// `/api/briefs(.*)` matcher, so it authenticates itself); the update is scoped
// to the caller's own briefs, so only the owner can edit. Same-origin fetch from
// the brief's page sends the session cookie.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { title?: string; body?: string };
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 300) : undefined;
  const ticketBody = typeof body?.body === "string" ? body.body : undefined;
  if (title === undefined && ticketBody === undefined) {
    return Response.json({ error: "nothing to update" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) patch.ticket_title = title || null;
  if (ticketBody !== undefined) patch.ticket_body = ticketBody;

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("briefs")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}
