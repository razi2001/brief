import { NextRequest, after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { processBriefById } from "@/lib/agent/run-processing";
import { PROVIDER_KEYS } from "@/lib/ticket-sync";
import type { ProviderKey } from "@/lib/tracker";
import { briefPhase, claimFiling, releaseFiling } from "@/lib/brief-filing";
import { resolveTrackerOrError } from "@/lib/trackers/registry";
import { errorMessage } from "@/lib/errors";
import { createAdminSupabase } from "@/lib/supabase/server";

export const maxDuration = 300;

// Export a drafted brief to the chosen tracker. Clerk-session-authed (matched by
// the public `/api/briefs(.*)` matcher); processBriefById is scoped to the
// caller's own briefs, so only the owner can export.
//
// The ticket is ALREADY written, so this is fast: it files the stored title/body
// verbatim and only routes + attaches evidence (no re-transcription, no keyframe
// vision). It takes the filing claim (which also marks the brief 'processing')
// and files in the background so the page can show a "Filing…" state
// immediately; a failed export releases the claim and puts the brief back to
// 'drafted' so the draft is never lost, with the reason on the row.
//
// The tracker is checked before the claim: a pick still to make, an expired
// connection or a tracker this deployment can't reach is answered right away
// with the line that says so, instead of a "Filing..." that quietly turns back
// into a draft.
//
// The claim is what stops a capture becoming two tickets: a brief that already
// has a ticket - or one another run is filing right now - is refused with 409
// instead of being filed again.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { provider?: string };
  // Which tracker to file this draft to. Validated against the real provider
  // list so an unknown value falls back to "whichever is connected" rather than
  // being passed through to the registry as a pin that can never resolve.
  const provider = PROVIDER_KEYS.includes(body?.provider as ProviderKey)
    ? (body!.provider as ProviderKey)
    : undefined;

  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs")
    .select("id, status, title, ticket_title, ticket_url, ticket_body, filing_started_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!brief) return Response.json({ error: "not found" }, { status: 404 });

  const phase = briefPhase(brief);
  if (phase === "filed") {
    return Response.json(
      { error: "already_filed", message: "This brief already has a ticket.", ticketUrl: brief.ticket_url },
      { status: 409 },
    );
  }
  if (phase === "filing") {
    return Response.json(
      { error: "already_filing", message: "This brief is being filed right now." },
      { status: 409 },
    );
  }
  if (phase !== "draft") {
    return Response.json({ error: "not_ready", message: "This brief isn't ready to export." }, { status: 409 });
  }
  // Filed verbatim, and a tracker won't take a ticket without a title. Only a
  // draft started blank can get here without one.
  if (!(brief.ticket_title || brief.title || "").trim()) {
    return Response.json({ error: "no_title", message: "Add a title first." }, { status: 409 });
  }

  // Only the reason is used here; processBriefById resolves the tracker again
  // when it files.
  const { error: trackerError } = await resolveTrackerOrError(userId, provider);
  if (trackerError) return Response.json({ error: trackerError }, { status: 409 });

  // Atomic: two clicks (or two tabs) race here and exactly one wins. A retry
  // clears the reason the last attempt left.
  if (!(await claimFiling(admin, userId, id, { error: null }))) {
    return Response.json(
      { error: "already_filing", message: "This brief is being filed right now." },
      { status: 409 },
    );
  }

  after(async () => {
    try {
      const r = await processBriefById(userId, id, { provider, useExistingContent: true });
      // A failed export must not destroy the draft - put it back to 'drafted'
      // and release the claim so the owner can retry, keeping why it failed.
      // Guarded on ticket_url, so an export that DID create a ticket stays
      // filed.
      if (!r.ok) await releaseFiling(admin, userId, id, { status: "drafted", error: r.error });
    } catch (e) {
      await releaseFiling(admin, userId, id, { status: "drafted", error: errorMessage(e) });
    }
  });

  return Response.json({ queued: true });
}
