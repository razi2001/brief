import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import { selectDistinctFrames } from "@/lib/agent/frame-hash";
import { noTrackerError, providerName, resolveTracker } from "@/lib/trackers/registry";
import { BRIEF_URL, type ProviderKey, type Tracker } from "@/lib/tracker";
import { processBrief, type BriefInput } from "@/lib/agent/process-brief";
import { composeDraftTicket } from "@/lib/agent/compose-draft";
import { transcribeAudio, transcriptionHint } from "@/lib/agent/transcribe";
import { mergeBriefOverrides, captionForScreenshot, type BriefOverrides } from "@/lib/agent/overrides";
import { summarizeReplay, type ReplaySummary } from "@/lib/agent/replay-steps";

type ReplayFrame = { file: string; t?: number; url?: string | null; note?: string | null };

/** The frame closest in time to `tMs` (frames without a time never match). */
export function nearestFrame<F extends { timestampMs?: number }>(frames: F[], tMs: number): F | undefined {
  let best: F | undefined;
  for (const f of frames) {
    if (typeof f.timestampMs !== "number") continue;
    if (!best || Math.abs(f.timestampMs - tMs) < Math.abs((best.timestampMs as number) - tMs)) best = f;
  }
  return best;
}

/** The page a recording was on at `tMs`: the last captured event at or before
 *  it that carries a URL (clicks, keys, scrolls, navigations), else the brief's. */
export function urlAt(json: unknown, tMs?: number): string | undefined {
  const j = (json ?? {}) as { events?: Array<{ tMs?: number; url?: string }>; pageUrl?: string };
  let url: string | undefined;
  if (typeof tMs === "number") {
    for (const e of Array.isArray(j.events) ? j.events : []) {
      if (typeof e?.tMs === "number" && e.tMs <= tMs && typeof e.url === "string" && e.url) url = e.url;
    }
  }
  return url ?? (typeof j.pageUrl === "string" && j.pageUrl ? j.pageUrl : undefined);
}
import { getUserSettings } from "@/lib/settings";
import { briefPhase, releaseFiling } from "@/lib/brief-filing";
import {
  findRecordingName,
  isRecordingName,
  isTranscribableRecording,
  recordingContentType,
  type RecordingName,
} from "@/lib/brief";

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

/**
 * Download a brief's media from storage and assemble the agent's BriefInput:
 * brief.json (with the popup's edits merged over it + transcript), a perceptually
 * de-duped keyframe storyboard, every reporter screenshot (with captions), and
 * the recording when the reporter chose to attach it. Shared by the filing path
 * (processBriefById) and the write-only draft path (draftBriefById) so both read
 * identical evidence.
 *
 * Returns the resolved `includeVideo` plus the raw keyframe `names` (the filing
 * path needs them to clean up storage afterwards).
 */
export async function loadBriefInput(
  admin: SupabaseClient,
  prefix: string,
  opts: {
    includeVideo?: boolean;
    overrides?: BriefOverrides;
    lean?: boolean;
    /**
     * The tracker takes uploads (Linear, Jira): the replay goes on the ticket
     * as its rendered video. Without (GitHub) the ticket links to the brief
     * page instead, where it plays.
     */
    uploadsVideo?: boolean;
    /**
     * Base for stable evidence URLs (`<origin>/api/evidence/<shareId>`). Set on
     * the filing path so adapters without an upload API (GitHub, Notion) can
     * embed the screenshots by URL. Omitted on the draft path, which files
     * nothing.
     */
    evidenceBaseUrl?: string;
  },
): Promise<{
  input: BriefInput;
  names: string[];
  includeVideo: boolean;
  recordingName: RecordingName | null;
}> {
  // Built per evidence file from its storage-relative path, so the URL always
  // matches what the evidence route is willing to serve.
  const evidenceUrl = (rel: string) =>
    opts.evidenceBaseUrl ? `${opts.evidenceBaseUrl}/${rel}` : undefined;
  const dl = async (p: string) => {
    const { data } = await admin.storage.from("briefs").download(p);
    return data ? Buffer.from(await data.arrayBuffer()) : null;
  };
  const briefJsonBuf = await dl(`${prefix}/brief.json`);
  const rawJson = briefJsonBuf ? JSON.parse(briefJsonBuf.toString("utf8")) : {};
  // The popup's edits (corrected transcript, per-shot notes, description, extra)
  // are authoritative over the capture-owned brief.json.
  const json = mergeBriefOverrides(rawJson, opts.overrides);
  // An attached replay (rrweb events) reaches the agent as plain steps (with
  // the URL at each), plus its stills and narration below.
  const replayBuf = await dl(`${prefix}/replay.json`);
  if (replayBuf) {
    try {
      const file = JSON.parse(replayBuf.toString("utf8"));
      json.replay = {
        ...summarizeReplay(file),
        frames: Array.isArray(file.frames) ? file.frames : [],
        marks: Array.isArray(file.marks) ? file.marks : [],
      };
    } catch (e) {
      console.warn(`[process] ${prefix}: unreadable replay.json:`, e);
    }
  }

  const images: BriefInput["images"] = [];
  const files: BriefInput["evidence"]["files"] = [];
  const items: BriefInput["evidence"]["items"] = [];
  const includeVideo = opts.includeVideo ?? !!json.includeVideo;

  // Where the recording lives. brief.json names it (an uploaded video keeps its
  // container: recording.mp4 / .mov); older captures and missing metadata fall
  // back to whatever recording.* object is actually in storage.
  const namedRec = (json as { recording?: { file?: unknown } }).recording?.file;
  let recName: RecordingName | null = isRecordingName(namedRec) ? namedRec : null;
  if (!recName) {
    const { data: rootList } = await admin.storage.from("briefs").list(prefix, { limit: 100 });
    recName = findRecordingName((rootList ?? []).map((o) => o.name));
  }

  // `lean` = export of an already-written ticket: skip transcription and the
  // keyframe vision storyboard (we're routing + attaching evidence, not
  // rewriting). This is what makes export fast - no Whisper, no keyframe
  // downloads, no vision tokens.
  let frames: Array<{ name: string; filename: string; timestampMs?: number; bytes: Buffer }> = [];

  // Always list the keyframes (cheap) so the caller can clean them up after
  // filing, even on a lean export that doesn't read them.
  const { data: kf } = await admin.storage.from("briefs").list(`${prefix}/keyframes`, { limit: 200 });
  const names = (kf ?? []).map((o) => o.name).sort();

  if (!opts.lean) {
    // Transcribe only when the popup didn't give us an edited transcript. Fail-soft.
    if (!(typeof json.transcript === "string" && json.transcript.trim())) {
      let audioInput: { bytes: Buffer; filename: string; contentType: string } | null = null;
      const audioBuf = await dl(`${prefix}/audio.webm`);
      if (audioBuf) {
        audioInput = { bytes: audioBuf, filename: "audio.webm", contentType: "audio/webm" };
      } else if (recName && isTranscribableRecording(recName)) {
        const recBuf = await dl(`${prefix}/${recName}`);
        if (recBuf && recBuf.length <= 25 * 1024 * 1024) {
          audioInput = { bytes: recBuf, filename: recName, contentType: recordingContentType(recName) };
        }
      }
      const transcript = await transcribeAudio(audioInput && { ...audioInput, prompt: transcriptionHint(json) });
      if (transcript) json.transcript = transcript;
    }

    // Keyframe storyboard (vision): download all, keep the perceptually-distinct.
    const tsByFile = new Map<string, number>();
    for (const k of Array.isArray(json.keyframes) ? json.keyframes : []) {
      const file = String(k?.file ?? "").split("/").pop();
      if (file && typeof k?.timestamp === "number") tsByFile.set(file, k.timestamp);
    }
    const downloaded = await Promise.all(
      names.map(async (n) => {
        const bytes = await dl(`${prefix}/keyframes/${n}`);
        const filename = n.split("/").pop() || n;
        return bytes ? { name: n, filename, timestampMs: tsByFile.get(filename), bytes } : null;
      }),
    );
    const usable = downloaded.filter((f): f is NonNullable<typeof f> => !!f);
    frames = selectDistinctFrames(usable);
    // The reporter's marks: the frame nearest each one is always shown, and
    // says it was marked (with the note), however similar it looks.
    const marks = (json as { recordingMarks?: Array<{ t: number; note?: string }> }).recordingMarks ?? [];
    const markedBy = new Map<string, string>();
    for (const m of marks) {
      const near = nearestFrame(usable, m.t);
      if (!near) continue;
      markedBy.set(near.name, m.note?.trim() ? `MARKED by the reporter: "${m.note.trim()}"` : "MARKED by the reporter");
      if (!frames.includes(near)) frames.push(near);
    }
    frames.sort((x, y) => (x.timestampMs ?? 0) - (y.timestampMs ?? 0));
    for (const f of frames) {
      images.push({
        name: f.name,
        dataUrl: `data:image/png;base64,${f.bytes.toString("base64")}`,
        timestampMs: f.timestampMs,
        url: urlAt(json, f.timestampMs),
        caption: markedBy.get(f.name),
      });
    }

    // The replay, watched: the stills the extension took at its key moments
    // (each page, the clicks, the end), with the page URL at each.
    const replayMeta = (json as { replay?: ReplaySummary & { frames?: ReplayFrame[] } }).replay;
    if (replayMeta) {
      const files = (await admin.storage.from("briefs").list(`${prefix}/replay-frames`, { limit: 50 })).data ?? [];
      const byFile = new Map((replayMeta.frames ?? []).map((f) => [f.file, f]));
      for (const o of files.map((x) => x.name).sort().slice(0, 12)) {
        const bytes = await dl(`${prefix}/replay-frames/${o}`);
        if (!bytes) continue;
        const meta = byFile.get(o);
        images.push({
          name: `replay-frame-${o}`,
          dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
          timestampMs: meta?.t,
          url: meta?.url ?? undefined,
          caption: meta?.note ?? undefined,
        });
      }
    }

    // The replay's voice-over is narration of its own: transcribe it apart.
    if (replayMeta) {
      const voice = await dl(`${prefix}/replay-voice.webm`);
      if (voice) {
        // the hint: the brief's own words, plus what the replay shows (the
        // pages and buttons it went through) and the reporter's mark notes
        const replay = json.replay as { steps?: string[]; marks?: Array<{ note?: string }> } | undefined;
        const prompt = transcriptionHint(json, [
          ...(replay?.steps ?? []).slice(0, 20),
          ...(replay?.marks ?? []).map((m) => m?.note ?? ""),
        ]);
        const narration = await transcribeAudio({ bytes: voice, filename: "replay-voice.webm", contentType: "audio/webm", prompt });
        if (narration) replayMeta.narration = narration;
      }
    }
  }

  // Screenshots: attachable evidence (always); shown to the model as vision only
  // when writing (skipped in lean export).
  const shotMeta = Array.isArray((json as any).screenshots) ? (json as any).screenshots : [];
  const shotPaths: string[] = [];
  const { data: shotList } = await admin.storage.from("briefs").list(`${prefix}/screenshots`, { limit: 200 });
  for (const o of shotList ?? []) shotPaths.push(`screenshots/${o.name}`);
  shotPaths.sort();
  shotPaths.push("screenshot.png"); // legacy single (dl returns null when absent)
  const shotFilenames: string[] = [];
  for (const rel of shotPaths) {
    const b = await dl(`${prefix}/${rel}`);
    if (!b) continue;
    const filename = rel.split("/").pop() || rel;
    const caption = captionForScreenshot(rel, shotMeta);
    if (!opts.lean) images.push({ name: rel, dataUrl: `data:image/png;base64,${b.toString("base64")}`, caption });
    files.push({ filename, contentType: "image/png", bytes: b, url: evidenceUrl(rel) });
    items.push({ name: filename, kind: "screenshot", caption });
    shotFilenames.push(filename);
  }
  const hasShot = shotFilenames.length > 0;

  // The replay's stills: the agent sees them all (above), but only the moments
  // the reporter FLAGGED go on the ticket, captioned with their note - one flag,
  // one image. With no flag, just the last still (where the replay ends, at the
  // report). Named as stored, so a tracker that embeds by url keeps them after
  // cleanup (see the referenced set).
  const replayJson = json as { replay?: { frames?: ReplayFrame[] }; includeReplay?: boolean };
  const markedStills: string[] = [];
  if (replayJson.replay && replayJson.includeReplay !== false) {
    // The replay itself, as a video (rendered by the extension), first.
    let videoAttached = false;
    if (opts.uploadsVideo) {
      const video = await dl(`${prefix}/replay.webm`);
      if (video) {
        files.push({ filename: "replay.webm", contentType: "video/webm", bytes: video, url: evidenceUrl("replay.webm") });
        items.push({ name: "replay.webm", kind: "replay-video" });
        markedStills.push("replay.webm");
        videoAttached = true;
      }
    }
    const meta = new Map((replayJson.replay.frames ?? []).map((f) => [f.file, f]));
    const { data: rfList } = await admin.storage.from("briefs").list(`${prefix}/replay-frames`, { limit: 50 });
    const stills = (rfList ?? []).map((o) => o.name).sort().slice(0, 12);
    const isMarked = (name: string) => /^marked by the reporter/i.test(meta.get(name)?.note?.trim() ?? "");
    const flagged = stills.filter(isMarked);
    // with the video on the ticket, an unflagged replay needs no still at all
    for (const name of flagged.length ? flagged : videoAttached ? [] : stills.slice(-1)) {
      const b = await dl(`${prefix}/replay-frames/${name}`);
      if (!b) continue;
      const m = meta.get(name);
      const marked = isMarked(name);
      const caption = marked
        ? (m?.note ?? "").trim().replace(/^marked by the reporter:?\s*/i, "").replace(/^"|"$/g, "") || undefined
        : undefined;
      files.push({ filename: name, contentType: "image/jpeg", bytes: b, url: evidenceUrl(`replay-frames/${name}`) });
      items.push({ name, kind: "replay", timestampMs: m?.t, caption });
      markedStills.push(name);
    }
  }

  // The recording is attachable ONLY when the user said so.
  const recordingExists = !!recName || !!json.recording || names.length > 0;
  if (includeVideo && recName) {
    const rec = await dl(`${prefix}/${recName}`);
    if (rec) {
      files.push({
        filename: recName,
        contentType: recordingContentType(recName),
        bytes: rec,
        url: evidenceUrl(recName),
      });
      items.push({ name: recName, kind: "recording" });
    }
  } else if (recordingExists) {
    items.push({ name: recName ?? "recording.webm", kind: "recording" });
  }

  // Keyframes earn an attachment slot only when there's nothing else to show.
  const recordingAttached = files.some((f) => f.filename === recName);
  const keyframesAsEvidence = !hasShot && !recordingAttached && frames.length > 0;
  if (keyframesAsEvidence) {
    for (const f of frames) {
      files.push({
        filename: f.filename,
        contentType: "image/png",
        bytes: f.bytes,
        // `f.name` is the storage-relative path ("keyframes/003.png"). A
        // recording-only capture has no screenshots, so these frames ARE the
        // evidence - without a url a GitHub or Notion ticket would get none.
        url: evidenceUrl(f.name),
      });
      items.push({ name: f.filename, kind: "keyframe", timestampMs: f.timestampMs });
    }
  }

  // Default attachment set when the agent doesn't choose.
  const fallback: string[] = [];
  for (const fn of shotFilenames) fallback.push(fn);
  fallback.push(...markedStills);
  if (recordingAttached) {
    fallback.push(recName ?? "recording.webm");
  } else if (keyframesAsEvidence) {
    const lean = frames.length <= 2 ? frames : [frames[0], frames[frames.length - 1]];
    for (const f of lean) fallback.push(f.filename);
  }

  return {
    input: { json, images, evidence: { files, items, includeVideo, fallback, forced: markedStills } },
    names,
    includeVideo,
    recordingName: recName,
  };
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
 * draft files to the chosen tracker); unset = Linear preferred, Jira fallback.
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
  // file somewhere else); otherwise the registry picks the connected one.
  const tracker: Tracker | null = await resolveTracker(userId, opts.provider);
  if (!tracker) {
    const error = opts.provider
      ? `${providerName(opts.provider)} is not connected - reconnect it under Settings, then retry.`
      : await noTrackerError(userId);
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

    const { input, names, includeVideo, recordingName } = await loadBriefInput(admin, prefix, {
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
      const { error: updErr } = await admin
        .from("briefs")
        .update({
          ...filedPatch,
          ticket_title: result.ticketTitle || null,
          ticket_state_name: result.ticketState?.name ?? null,
          ticket_state_color: result.ticketState?.color ?? null,
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
  } catch (e: any) {
    // Nothing was filed (the throw is from before create_issue, or from a run
    // that never created one) - fail the brief AND hand the claim back so the
    // owner can retry straight away.
    await releaseFiling(admin, userId, briefId, { status: "failed", error: String(e?.message ?? e) });
    return { ok: false, status: 500, error: String(e?.message ?? e) };
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
    const { input } = await loadBriefInput(admin, prefix, { overrides: opts.overrides });
    const draft = await composeDraftTicket(input, guidance);

    const shareId = (brief.share_id as string | null) || randomBytes(9).toString("base64url");
    const draftedPatch = { status: "drafted", updated_at: new Date().toISOString() };
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
  } catch (e: any) {
    await draftWrite({ status: "failed", error: String(e?.message ?? e) });
    return { ok: false, status: 500, error: String(e?.message ?? e) };
  }
}
