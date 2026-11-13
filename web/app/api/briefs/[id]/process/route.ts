import { NextRequest, after } from "next/server";
import { randomBytes } from "crypto";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { draftBriefById, processBriefById } from "@/lib/agent/run-processing";
import { runDraftJob } from "@/lib/agent/draft-jobs";
import { holdAsDraft } from "@/lib/agent/hold-draft";
import { briefPhase, claimFiling } from "@/lib/brief-filing";
import { markForBash, runningBashOf } from "@/lib/bash-server";
import { labelInstruction } from "@/lib/bash-review";
import { createAdminSupabase } from "@/lib/supabase/server";
import { corsPreflight, jsonCors } from "@/lib/cors";
import { NO_TRACKER_ERROR, trackerStatus } from "@/lib/trackers/registry";
import { track } from "@/lib/events";

export const maxDuration = 300;

/** What the popup sends at file time: the reporter's edits, and whether this brief is for their bug bash. */
type FileBody = {
  title?: string;
  includeVideo?: boolean;
  transcript?: string;
  description?: string;
  extra?: Array<{ key: string; value: string }>;
  screenshots?: Array<{ file: string; description?: string; annotated?: boolean }>;
  /** false when the popup's bug bash switch is off for this brief. */
  bash?: boolean;
};

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = bearerFromHeader(req.headers.get("authorization"));
  const userId = token ? await userIdForToken(token) : null;
  if (!userId) return jsonCors({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as FileBody;

  // For a bug bash? Only when the reporter is in a running one and left the
  // popup's switch on for this brief (an extension from before the switch
  // sends nothing, which counts as on). One that holds keeps the brief as a
  // draft for the review at its end, so no tracker is needed to take part;
  // otherwise it is filed as usual, with the bug bash's name as a label.
  // Never a reason to fail: if the bug bash can't be read, the brief files
  // the normal way.
  const bash = body?.bash === false ? null : await runningBashOf(userId).catch(() => null);
  if (bash?.hold) return holdForReview(body, userId, id, bash.id);

  // Refuse up front when no tracker is connected, BEFORE flipping the row to
  // 'processing' - the extension gets an immediate, actionable 409 instead of a
  // brief that silently stalls and times out. The brief stays an uploaded draft
  // so it can be filed once a tracker is linked. The message says what to fix:
  // connect one, pick a workspace, or reconnect an expired one.
  const { tracker, issue } = await trackerStatus(userId);
  if (!tracker) {
    track(userId, "brief.file_refused", { reason: "no_tracker" });
    return jsonCors(
      {
        error: "no_tracker",
        message: issue ?? NO_TRACKER_ERROR,
      },
      { status: 409 },
    );
  }

  // Optional brief name - recordings are uploaded as a draft without one, so the
  // popup passes it now (at file time) for the dashboard to show while filing.
  // `includeVideo` is the user's "attach the recording" toggle, also only known
  // at file time (set in the popup after the draft was uploaded).
  const title = (body?.title ?? "").toString().trim();
  const includeVideo = body?.includeVideo === true;
  const overrides = {
    title: title || undefined,
    includeVideo,
    transcript: typeof body?.transcript === "string" ? body.transcript : undefined,
    description: typeof body?.description === "string" ? body.description : undefined,
    extra: Array.isArray(body?.extra) ? body.extra : undefined,
    screenshots: Array.isArray(body?.screenshots) ? body.screenshots : undefined,
  };

  // Mark it queued (processing) right away, scoped to the caller, and mint the
  // share token NOW (preserving an existing one) so the extension can open the
  // brief page immediately - it shows the "writing…" state and resolves into the
  // filed ticket. The agent run happens in the background via after().
  const admin = createAdminSupabase();
  const { data: existing } = await admin
    .from("briefs")
    .select("id, share_id, ticket_url")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!existing) return jsonCors({ error: "not found" }, { status: 404 });

  const shareId = (existing.share_id as string | null) || randomBytes(9).toString("base64url");
  // Take the filing claim in the same write that marks it queued. It fails when
  // this capture already has a ticket, or another run is filing it - so a
  // re-submit can never file a second ticket for the same brief.
  const claimed = await claimFiling(admin, userId, id, {
    share_id: shareId,
    ...(title ? { title } : {}),
  });
  if (!claimed) {
    return jsonCors(
      {
        error: "already_filed",
        message: existing.ticket_url
          ? "This capture was already filed - open it in Brief."
          : "This capture is being filed right now.",
        shareId,
      },
      { status: 409 },
    );
  }

  if (bash) await markForBash(bash.id, id, admin).catch(() => {});

  after(async () => {
    // Errors are handled inside processBriefById (it flips the row to 'failed').
    await processBriefById(userId, id, {
      includeVideo,
      overrides,
      instruction: bash ? labelInstruction(bash.name) : undefined,
    }).catch(() => {});
  });

  return jsonCors({ queued: true, shareId });
}

/**
 * "Create ticket" for a bug bash that holds its reports: the brief is written
 * up and kept as a draft. Whoever started the bug bash files one ticket per
 * bug once it is over.
 * Answers like a queued filing, plus `held`, so an extension that knows about
 * bashes can say so and one that doesn't still carries on.
 */
async function holdForReview(body: FileBody, userId: string, id: string, bashId: string) {
  const title = (body?.title ?? "").toString().trim();
  const overrides = {
    title: title || undefined,
    includeVideo: body?.includeVideo === true,
    transcript: typeof body?.transcript === "string" ? body.transcript : undefined,
    description: typeof body?.description === "string" ? body.description : undefined,
    extra: Array.isArray(body?.extra) ? body.extra : undefined,
    screenshots: Array.isArray(body?.screenshots) ? body.screenshots : undefined,
  };

  const admin = createAdminSupabase();
  const { data: existing } = await admin
    .from("briefs")
    .select("id, share_id, storage_prefix, status, ticket_body, ticket_url, filing_started_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!existing) return jsonCors({ error: "not found" }, { status: 404 });

  const phase = briefPhase(existing);
  if (phase === "filed" || phase === "filing") {
    return jsonCors(
      {
        error: "already_filed",
        message: existing.ticket_url ? "This capture was already filed - open it in Brief." : "This capture is being filed right now.",
        shareId: existing.share_id,
      },
      { status: 409 },
    );
  }

  // Already written up (the popup retried, or the same brief was sent twice):
  // it only has to count. Marking it as being written again would leave it
  // there, since a brief with a body is never written a second time.
  if (phase === "draft") {
    await markForBash(bashId, id, admin).catch(() => {});
    return jsonCors({ queued: true, shareId: existing.share_id, held: true });
  }

  const shareId = await holdAsDraft(
    admin,
    userId,
    id,
    { share_id: existing.share_id as string | null, storage_prefix: existing.storage_prefix as string },
    overrides,
    title,
  );
  await markForBash(bashId, id, admin).catch(() => {});
  after(async () => {
    await runDraftJob(id, () => draftBriefById(userId, id));
  });
  return jsonCors({ queued: true, shareId, held: true });
}
