import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { draftBriefById, processBriefById } from "@/lib/agent/run-processing";
import { runDraftJob } from "@/lib/agent/draft-jobs";
import { heldByBash } from "@/lib/bash-server";
import { claimFiling } from "@/lib/brief-filing";
import { createAdminSupabase } from "@/lib/supabase/server";
import { track } from "@/lib/events";

export const maxDuration = 300;

// Clerk-session-authed retry for a failed brief. This path is matched by the
// public `/api/briefs(.*)` matcher in proxy.ts, so the handler authenticates
// itself via the Clerk session - a same-origin fetch from the dashboard sends
// the cookie. CORS is unnecessary (same-origin) so it's omitted.
//
// The claim refuses a brief that already has a ticket (or one being filed), so
// "Retry" on a brief that actually got filed can't create a duplicate.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs")
    .select("id, status, ticket_body, ticket_url, filing_started_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!brief) return Response.json({ error: "not found" }, { status: 404 });

  // A report a bug bash holds for its review, whose write-up failed: Retry
  // writes it up again. Filing it here would go around the review.
  if (brief.status === "failed" && !brief.ticket_body && !brief.ticket_url && !brief.filing_started_at && (await heldByBash(id, admin).catch(() => false))) {
    const marked = await admin
      .from("briefs")
      .update({ status: "processing", error: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("status", "failed")
      .is("ticket_url", null)
      .is("filing_started_at", null)
      .select("id");
    if (marked.error || !marked.data?.length) return Response.json({ error: "Couldn't retry. Try again" }, { status: 409 });
    track(userId, "brief.retry");
    await runDraftJob(id, () => draftBriefById(userId, id));
    const after = await admin.from("briefs").select("status, error").eq("id", id).maybeSingle();
    return after.data?.status === "drafted"
      ? Response.json({ ok: true, held: true })
      : Response.json({ error: (after.data?.error as string | null) ?? "Couldn't write the draft. Try again" }, { status: 500 });
  }

  if (!(await claimFiling(admin, userId, id))) {
    return Response.json(
      { error: "already_filed", message: "This brief already has a ticket, or is being filed." },
      { status: 409 },
    );
  }

  track(userId, "brief.retry");
  const r = await processBriefById(userId, id);
  return r.ok ? Response.json(r.result) : Response.json({ error: r.error }, { status: r.status });
}
