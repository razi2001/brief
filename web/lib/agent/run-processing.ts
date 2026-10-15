import { errorMessage } from "@/lib/errors";
import { randomBytes } from "crypto";
import { createAdminSupabase } from "@/lib/supabase/server";
import { resolveTrackerOrError } from "@/lib/trackers/registry";
import { BRIEF_URL, type ProviderKey, type Tracker } from "@/lib/tracker";
import { processBrief, type FileResult } from "@/lib/agent/process-brief";
import { composeDraftTicket } from "@/lib/agent/compose-draft";
import type { BriefOverrides } from "@/lib/agent/overrides";
import { loadBriefInput } from "@/lib/agent/load-brief-input";
import { supabaseStore } from "@/lib/agent/brief-store";
import { getUserSettings } from "@/lib/settings";
import { briefPhase, releaseFiling } from "@/lib/brief-filing";

// moved to load-brief-input.ts; re-exported for existing importers
export { loadBriefInput, nearestFrame, urlAt } from "@/lib/agent/load-brief-input";

export type ProcessResult =
  | { ok: true; result: { ticketUrl: string; ticketIdentifier: string; summary: string } }
  | { ok: false; status: number; error: string };

/**
 * Where this deployment is reachable, for building evidence URLs that a tracker
 * will fetch server-side. Falls back to the canonical app URL so a misconfigured
 * env produces links to production rather than to localhost.
 */
function appOrigin(): string {
  const raw = process.env.APP_URL || BRIEF_URL;
  return raw.replace(/\/+$/, "");
}

/** Account-level ticket guidance + reporter role, as one instruction string. */
async function loadGuidance(userId: string): Promise<string> {
  const { ticketGuidance, role } = await getUserSettings(userId);
  return [role ? `The reporter's role: ${role}.` : "", ticketGuidance]
    .filter(Boolean)
    .join("\n");
}


/** How long the filed ticket's live status may hold up recording the ticket. */
const LIVE_STATE_MS = 5_000;

/**
 * The status to store for a ticket just filed, as the tickets feed will show
 * it: the tracker's live read (getLiveIssues, the feed's own source) when it
 * has the issue, else what the agent read back. Some adapters' getIssue gives
 * no colour (GitLab, Asana, Monday) or a raw label (GitLab's
 * `workflow::In review`), and that first snapshot is what the feed shows
 * until its next sync. Time-boxed, because the row that records the ticket
 * waits on it.
 */
export async function filedTicketState(
  tracker: Tracker,
  identifier: string,
  fallback: FileResult["ticketState"],
  timeoutMs = LIVE_STATE_MS,
): Promise<{ name: string | null; color: string | null }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const live = await Promise.race([
      tracker.getLiveIssues([identifier]).then((r) => r.issues[identifier]),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
    if (live?.stateName) return { name: live.stateName, color: live.stateColor || null };
  } catch {
    /* display data only: the agent's read stands */
  } finally {
    clearTimeout(timer);
  }
  return { name: fallback?.name ?? null, color: fallback?.color ?? null };
}

/**
 * Orchestrates FILING a single brief: resolve the tracker, download media, run
 * the agent, mark the row 'filed' + clean up on success, or 'failed' on error.
 *
 * CALLERS MUST HOLD THE FILING CLAIM (claimFiling, lib/brief-filing.ts) before
 * calling this - that's what stops a capture becoming two tickets. This function
 * releases the claim when it fails WITHOUT creating a ticket, so a retry works
 * immediately; once a ticket exists the row keeps its ticket_url and can never
 * be filed again.
 *
 * `opts.provider` pins the tracker (used by the brief page's export action so a
 * draft files to the chosen tracker); unset = the first connected tracker in
 * registry order.
 * The brief's existing share_id is preserved so a draft's link stays stable
 * across export. On success the screenshots (and the recording, when attached)
 * are KEPT in storage so the shareable brief page can embed them.
 */
export async function processBriefById(
  userId: string,
  briefId: string,
  opts: {
    includeVideo?: boolean;
    overrides?: BriefOverrides;
    provider?: ProviderKey;
    // Export of a draft the reporter already iterated on: file the stored
    // title/body verbatim (only route + set fields), don't rewrite.
    useExistingContent?: boolean;
  } = {},
): Promise<ProcessResult> {
  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs")
    .select("*")
    .eq("id", briefId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!brief) return { ok: false, status: 404, error: "not found" };

  // Resolve the tracker. A pinned provider uses only that one (never silently
  // file somewhere else); otherwise the registry picks the connected one. A
  // miss comes back with the line that says why: nothing connected, a pending
  // workspace pick, an expired connection.
  const { tracker, error } = await resolveTrackerOrError(userId, opts.provider);
  if (!tracker) {
    await releaseFiling(admin, userId, briefId, { status: "failed", error });
    return { ok: false, status: 409, error };
  }

  const guidance = await loadGuidance(userId);

  try {
    const prefix = brief.storage_prefix as string;

    // Trackers with no upload API (GitHub) or that prefer a URL (Notion) embed
    // the screenshots by link, so those links have to resolve the moment the
    // ticket is rendered. The share token is therefore minted AND PERSISTED
    // before filing rather than afterwards - the evidence route looks a brief
    // up by share_id, and a token that only lands in the post-filing write
    // would leave a race where GitHub fetches the image first and caches a 404.
    const shareId = (brief.share_id as string | null) || randomBytes(9).toString("base64url");
    const embedsEvidenceByUrl = !tracker.capabilities.nativeAttachments;
    // An attached replay is watched on the brief page, so the ticket links to
    // it - which needs the share token now too, whatever the tracker.
    const hasReplay = !!(await admin.storage.from("briefs").list(prefix, { search: "replay.json" })).data?.length
      && opts.overrides?.includeReplay !== false;
    if ((embedsEvidenceByUrl || hasReplay) && !brief.share_id) {
      await admin.from("briefs").update({ share_id: shareId }).eq("id", briefId);
    }

    const { input, names, includeVideo, recordingName } = await loadBriefInput(supabaseStore(admin), prefix, {
      includeVideo: opts.includeVideo,
      overrides: opts.overrides,
      // Export of a finalized draft: skip transcription + keyframe vision (the
      // ticket is already written; we only route + attach evidence).
      lean: !!opts.useExistingContent,
      evidenceBaseUrl: `${appOrigin()}/api/evidence/${shareId}`,
      uploadsVideo: !embedsEvidenceByUrl,
    });

    // A link out only where the replay can't be uploaded (GitHub has no upload
    // API); a tracker that takes attachments gets the evidence itself.
    if (hasReplay && embedsEvidenceByUrl) input.replayUrl = `${appOrigin()}/b/${shareId}`;

    console.log(
      `[process] brief ${briefId} via ${tracker.kind}: keyframes=${names.length} screenshots=${input.evidence.items.filter((i) => i.kind === "screenshot").length} includeVideo=${includeVideo} attachable=${input.evidence.files.length} fallback=${input.evidence.fallback.length}`,
    );

    // Exporting a draft the reporter finalized: file their exact title/body.
    const fixed =
      opts.useExistingContent && (brief.ticket_body || brief.ticket_title)
        ? {
            title: ((brief.ticket_title as string | null) || (brief.title as string | null) || "").trim(),
            description: ((brief.ticket_body as string | null) || "").trim(),
          }
        : undefined;

    const result = await processBrief(input, tracker, guidance, fixed);

    const filedPatch = {
      status: "filed",
      ticket_url: result.ticketUrl,
      ticket_identifier: result.ticketIdentifier,
      // Which tracker this went to, recorded rather than inferred from the url
      // later - with seven providers a hostname guess is no longer safe.
      ticket_provider: tracker.kind,
      updated_at: new Date().toISOString(),
    };
    // THE TICKET NOW EXISTS. Everything below is bookkeeping - it must never
    // throw out to the catch, because marking the brief failed/retryable here
    // would file a duplicate on the next run. Recording ticket_url is the one
    // thing worth retrying: it's the permanent "already filed" guard.
    try {
      const state = await filedTicketState(tracker, result.ticketIdentifier, result.ticketState);
      const { error: updErr } = await admin
        .from("briefs")
        .update({
          ...filedPatch,
          ticket_title: result.ticketTitle || null,
          ticket_state_name: state.name,
          ticket_state_color: state.color,
          ticket_body: result.descriptionMarkdown || null,
          share_id: shareId,
        })
        .eq("id", briefId);
      if (updErr) await admin.from("briefs").update(filedPatch).eq("id", briefId);
    } catch (e) {
      console.error(`[process] brief ${briefId} filed as ${result.ticketIdentifier} but the row didn't update:`, e);
      try {
        await admin.from("briefs").update(filedPatch).eq("id", briefId);
      } catch {
        /* the ticket exists either way; the claim stays held so nothing re-files */
      }
    }

    // Clean up internal/large media, but KEEP the screenshots and (when the
    // reporter chose to attach it) the recording, so the shareable brief page
    // can embed them. brief.json, the audio track, and the sampled keyframes
    // are never shown on the page. Best-effort: the ticket is already filed.
    try {
      const toDelete: string[] = [
        `${prefix}/brief.json`,
        `${prefix}/audio.webm`,
        ...names.map((n) => `${prefix}/keyframes/${n}`),
      ];
      if (!includeVideo && recordingName) toDelete.push(`${prefix}/${recordingName}`);
      // A replay the reporter didn't attach informed the write-up only: like an
      // unattached video, it isn't kept on the brief.
      if ((input.json as { includeReplay?: boolean }).includeReplay === false) {
        toDelete.push(`${prefix}/replay.json`, `${prefix}/replay-voice.webm`);
      }
      // The replay's video went onto the ticket (or wasn't usable there); the
      // brief page plays the replay itself, so the copy here isn't needed.
      toDelete.push(`${prefix}/replay.webm`);
      // The replay stills: kept only when a ticket embeds one by url (below).
      const { data: rf } = await admin.storage.from("briefs").list(`${prefix}/replay-frames`, { limit: 50 });
      toDelete.push(...(rf ?? []).map((o) => `${prefix}/replay-frames/${o.name}`));
      // Keyframes are normally internal-only. But when the tracker embeds
      // evidence BY URL, a keyframe that was attached is referenced from the
      // filed ticket, and deleting it would leave a permanently broken image.
      const referenced = new Set(
        embedsEvidenceByUrl ? input.evidence.files.map((f) => f.filename) : [],
      );
      await admin.storage
        .from("briefs")
        .remove(toDelete.filter((p) => !referenced.has(p.split("/").pop() ?? "")));
    } catch (e) {
      console.warn(`[process] brief ${briefId}: media cleanup failed (ticket is filed):`, e);
    }

    return { ok: true, result };
  } catch (e) {
    // Nothing was filed (the throw is from before create_issue, or from a run
    // that never created one) - fail the brief AND hand the claim back so the
    // owner can retry straight away.
    await releaseFiling(admin, userId, briefId, { status: "failed", error: errorMessage(e) });
    return { ok: false, status: 500, error: errorMessage(e) };
  }
}

/**
 * Orchestrates DRAFTING a brief: write the perfect ticket (title + markdown
 * body) WITHOUT filing it anywhere. No tracker needed. The brief lands as
 * 'drafted' with a body + a stable share token, and ALL its media is kept so a
 * later export (processBriefById) can route + file it normally.
 *
 * Bearer-authed via the extension's draft route.
 */
export async function draftBriefById(
  userId: string,
  briefId: string,
  opts: { overrides?: BriefOverrides } = {},
): Promise<ProcessResult> {
  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs")
    .select("*")
    .eq("id", briefId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!brief) return { ok: false, status: 404, error: "not found" };

  // Only ever write over a brief that is still being written up. A brief that
  // is being FILED (or is filed) must not be turned back into a draft - that's
  // what re-offered "Export" on an already-filed capture and produced a second
  // ticket.
  if (briefPhase(brief) !== "writing") {
    return { ok: false, status: 409, error: "not a draft in progress" };
  }

  const guidance = await loadGuidance(userId);

  // Every write below is scoped to a brief that is STILL an unfiled, unclaimed
  // draft, so a filing run that starts mid-write always wins.
  const draftWrite = (patch: Record<string, unknown>) =>
    admin
      .from("briefs")
      .update(patch)
      .eq("id", briefId)
      .eq("user_id", userId)
      .is("ticket_url", null)
      .is("filing_started_at", null);

  // 'processing' while the model writes (the page shows "writing the ticket…");
  // recoverOrphans only times out 'processing', never 'drafted'.
  await draftWrite({ status: "processing" });
  try {
    const prefix = brief.storage_prefix as string;
    const { input } = await loadBriefInput(supabaseStore(admin), prefix, { overrides: opts.overrides });
    const draft = await composeDraftTicket(input, guidance);

    const shareId = (brief.share_id as string | null) || randomBytes(9).toString("base64url");
    // A fresh draft has no failure to show; the page shows a draft's error as
    // the reason its last export failed.
    const draftedPatch = { status: "drafted", error: null, updated_at: new Date().toISOString() };
    const { error: updErr } = await draftWrite({
      ...draftedPatch,
      ticket_title: draft.title || null,
      ticket_body: draft.descriptionMarkdown || null,
      share_id: shareId,
    });
    if (updErr) await draftWrite(draftedPatch);

    // Keep ALL media: export re-runs the full filing agent, which needs the
    // brief.json/keyframes/etc. Storage is cleaned up at filing time instead.
    return {
      ok: true,
      result: { ticketUrl: "", ticketIdentifier: "", summary: draft.title || "drafted" },
    };
  } catch (e) {
    await draftWrite({ status: "failed", error: errorMessage(e) });
    return { ok: false, status: 500, error: errorMessage(e) };
  }
}
