import { createHash, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getLinearToken, makeLinearTracker } from "@/lib/linear";
import { getJiraAuth, getJiraCloud, makeJiraTracker } from "@/lib/jira";
import type { Tracker } from "@/lib/tracker";
import { processBrief, type BriefInput } from "@/lib/agent/process-brief";
import { composeDraftTicket } from "@/lib/agent/compose-draft";
import { transcribeAudio } from "@/lib/agent/transcribe";
import { getUserSettings } from "@/lib/settings";

export type ProcessResult =
  | { ok: true; result: { ticketUrl: string; ticketIdentifier: string; summary: string } }
  | { ok: false; status: number; error: string };

/** Account-level ticket guidance + reporter role, as one instruction string. */
async function loadGuidance(userId: string): Promise<string> {
  const { ticketGuidance, role } = await getUserSettings(userId);
  return [role ? `The reporter's role: ${role}.` : "", ticketGuidance]
    .filter(Boolean)
    .join("\n");
}

/**
 * Download a brief's media from storage and build the agent's BriefInput:
 * brief.json (+ transcription), distinct sampled keyframes, the annotated
 * screenshot, and the recording when the reporter chose to attach it. Shared by
 * the filing path (processBriefById) and the write-only draft path
 * (draftBriefById) so both read identical evidence.
 *
 * Returns the resolved `includeVideo` and the raw keyframe `names` (the filing
 * path needs them to clean up storage afterwards).
 */
async function loadBriefInput(
  admin: SupabaseClient,
  prefix: string,
  optIncludeVideo?: boolean,
): Promise<{ input: BriefInput; names: string[]; includeVideo: boolean }> {
  const dl = async (p: string) => {
    const { data } = await admin.storage.from("briefs").download(p);
    return data ? Buffer.from(await data.arrayBuffer()) : null;
  };
  const briefJsonBuf = await dl(`${prefix}/brief.json`);
  const json = briefJsonBuf ? JSON.parse(briefJsonBuf.toString("utf8")) : {};

  // Transcribe the audio-only track (uploaded alongside the video) with OpenAI
  // and surface it as json.transcript so buildContextBlock picks it up. Fail-
  // soft: missing audio or any API error leaves transcript null.
  let audioInput: { bytes: Buffer; filename: string; contentType: string } | null = null;
  const audioBuf = await dl(`${prefix}/audio.webm`);
  if (audioBuf) {
    audioInput = { bytes: audioBuf, filename: "audio.webm", contentType: "audio/webm" };
  } else {
    const recBuf = await dl(`${prefix}/recording.webm`);
    if (recBuf && recBuf.length <= 25 * 1024 * 1024) {
      audioInput = { bytes: recBuf, filename: "recording.webm", contentType: "video/webm" };
    }
  }
  const transcript = await transcribeAudio(audioInput);
  if (transcript) json.transcript = transcript;

  const images: BriefInput["images"] = [];
  const files: BriefInput["evidence"]["files"] = [];
  const items: BriefInput["evidence"]["items"] = [];

  const includeVideo = optIncludeVideo ?? !!json.includeVideo;

  // Sample up to 8 evenly-spaced keyframes, dropping exact duplicates.
  const { data: kf } = await admin.storage.from("briefs").list(`${prefix}/keyframes`, { limit: 200 });
  const names = (kf ?? []).map((o) => o.name).sort();
  const SAMPLE = 8;
  const pick =
    names.length <= SAMPLE
      ? names
      : Array.from({ length: SAMPLE }, (_, i) =>
          names[Math.round((i * (names.length - 1)) / (SAMPLE - 1))],
        );
  const frames: Array<{ name: string; filename: string; bytes: Buffer }> = [];
  const seenFrame = new Set<string>();
  for (const n of [...new Set(pick)]) {
    const b = await dl(`${prefix}/keyframes/${n}`);
    if (!b) continue;
    const hash = createHash("md5").update(b).digest("hex");
    if (seenFrame.has(hash)) continue; // identical frame - skip
    seenFrame.add(hash);
    frames.push({ name: n, filename: n.split("/").pop() || n, bytes: b });
  }

  const tsByFile = new Map<string, number>();
  for (const k of Array.isArray(json.keyframes) ? json.keyframes : []) {
    const file = String(k?.file ?? "").split("/").pop();
    if (file && typeof k?.timestamp === "number") tsByFile.set(file, k.timestamp);
  }

  for (const f of frames) {
    images.push({ name: f.name, dataUrl: `data:image/png;base64,${f.bytes.toString("base64")}` });
    files.push({ filename: f.filename, contentType: "image/png", bytes: f.bytes });
    items.push({ name: f.filename, kind: "keyframe", timestampMs: tsByFile.get(f.filename) });
  }

  // A user-annotated screenshot is intentional, focused markup - always show it.
  const shot = await dl(`${prefix}/screenshot.png`);
  if (shot) {
    images.push({ name: "screenshot.png", dataUrl: `data:image/png;base64,${shot.toString("base64")}` });
    files.push({ filename: "screenshot.png", contentType: "image/png", bytes: shot });
    items.push({ name: "screenshot.png", kind: "screenshot" });
  }

  // The recording is attachable ONLY when the user said so - when the toggle is
  // off we don't even download it, but still note its existence so the agent
  // knows not to allude to it.
  const recordingExists = !!json.recording || names.length > 0;
  if (includeVideo) {
    const rec = await dl(`${prefix}/recording.webm`);
    if (rec) {
      files.push({ filename: "recording.webm", contentType: "video/webm", bytes: rec });
      items.push({ name: "recording.webm", kind: "recording" });
    }
  } else if (recordingExists) {
    items.push({ name: "recording.webm", kind: "recording" });
  }

  // Default attachment set when the agent doesn't choose.
  const fallback: string[] = [];
  if (shot) fallback.push("screenshot.png");
  if (includeVideo && files.some((f) => f.filename === "recording.webm")) {
    fallback.push("recording.webm");
  } else if (!shot && frames.length) {
    const lean = frames.length <= 2 ? frames : [frames[0], frames[frames.length - 1]];
    for (const f of lean) fallback.push(f.filename);
  }

  return { input: { json, images, evidence: { files, items, includeVideo, fallback } }, names, includeVideo };
}

/**
 * Orchestrates FILING a single brief: load the row (scoped to userId), resolve
 * the tracker, download media, run the agent, mark the row 'filed' and clean up
 * media on success, or 'failed' on error.
 *
 * `opts.provider` pins the tracker (used by the page's export action so a draft
 * goes to the chosen tracker); unset means Linear preferred, Jira fallback - the
 * original behavior behind the extension's process route and the dashboard retry.
 * The brief's existing share_id is preserved so a draft's link stays stable
 * across export.
 */
export async function processBriefById(
  userId: string,
  briefId: string,
  opts: { includeVideo?: boolean; provider?: "linear" | "jira" } = {},
): Promise<ProcessResult> {
  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs")
    .select("*")
    .eq("id", briefId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!brief) return { ok: false, status: 404, error: "not found" };

  // Resolve the tracker. When a provider is pinned, use only that one (don't
  // silently file to the other). Otherwise Linear is preferred, Jira is fallback.
  let tracker: Tracker | null = null;
  if (opts.provider !== "jira") {
    const linearTok = await getLinearToken(userId);
    if (linearTok) tracker = makeLinearTracker(linearTok);
  }
  if (!tracker && opts.provider !== "linear") {
    const jiraTok = await getJiraAuth(userId);
    if (jiraTok) {
      const cloud = await getJiraCloud(jiraTok);
      if (cloud) tracker = makeJiraTracker(jiraTok, cloud);
    }
  }
  if (!tracker) {
    await admin
      .from("briefs")
      .update({
        status: "failed",
        error: "No tracker connected - connect Linear or Jira in Connections, then retry.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", briefId);
    return {
      ok: false,
      status: 409,
      error: "No tracker connected - connect Linear or Jira in Connections, then retry.",
    };
  }

  const guidance = await loadGuidance(userId);

  await admin.from("briefs").update({ status: "processing" }).eq("id", briefId);
  try {
    const prefix = brief.storage_prefix as string;
    const { input, names, includeVideo } = await loadBriefInput(admin, prefix, opts.includeVideo);
    const distinct = input.evidence.items.filter((it) => it.kind === "keyframe").length;
    const hasShot = input.evidence.items.some((it) => it.kind === "screenshot");

    console.log(
      `[process] brief ${briefId} via ${tracker.kind}: frames=${names.length} distinct=${distinct} screenshot=${hasShot} includeVideo=${includeVideo} attachable=${input.evidence.files.length} fallback=${input.evidence.fallback.length}`,
    );

    const result = await processBrief(input, tracker, guidance);

    const filedPatch = {
      status: "filed",
      ticket_url: result.ticketUrl,
      ticket_identifier: result.ticketIdentifier,
      updated_at: new Date().toISOString(),
    };
    // Reuse the brief's share token if it already has one (e.g. it was a draft),
    // so the public link stays stable across export; otherwise mint one.
    const shareId = (brief.share_id as string | null) || randomBytes(9).toString("base64url");
    // Persist the real ticket title + initial state + the agent's markdown body
    // and the share token. Retry without the extra columns if the DB predates
    // migrations 0004/0005 - filing must never fail over display data.
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

    // Clean up internal/large media, but KEEP the screenshot and (when the
    // reporter chose to attach it) the recording, so the shareable brief page
    // can embed them. brief.json, the audio track, and the sampled keyframes
    // are never shown on the page.
    const toDelete: string[] = [
      `${prefix}/brief.json`,
      `${prefix}/audio.webm`,
      ...names.map((n) => `${prefix}/keyframes/${n}`),
    ];
    if (!includeVideo) toDelete.push(`${prefix}/recording.webm`);
    await admin.storage.from("briefs").remove(toDelete);

    return { ok: true, result };
  } catch (e: any) {
    await admin.from("briefs").update({ status: "failed", error: String(e?.message ?? e) }).eq("id", briefId);
    return { ok: false, status: 500, error: String(e?.message ?? e) };
  }
}

/**
 * Orchestrates DRAFTING a brief: write the perfect ticket (title + markdown
 * body) WITHOUT filing it anywhere. No tracker is needed. The brief lands as
 * 'drafted' with a body + a stable share token, and ALL its media is kept so a
 * later export (processBriefById) can route + file it normally.
 *
 * Bearer-authed via the extension's draft route.
 */
export async function draftBriefById(userId: string, briefId: string): Promise<ProcessResult> {
  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs")
    .select("*")
    .eq("id", briefId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!brief) return { ok: false, status: 404, error: "not found" };

  const guidance = await loadGuidance(userId);

  // 'processing' while the model writes (the feed/page shows "writing the
  // ticket"); recoverOrphans only times out 'processing', never 'drafted'.
  await admin.from("briefs").update({ status: "processing" }).eq("id", briefId);
  try {
    const prefix = brief.storage_prefix as string;
    const { input } = await loadBriefInput(admin, prefix);
    const draft = await composeDraftTicket(input, guidance);

    const shareId = (brief.share_id as string | null) || randomBytes(9).toString("base64url");
    const draftedPatch = { status: "drafted", updated_at: new Date().toISOString() };
    const { error: updErr } = await admin
      .from("briefs")
      .update({
        ...draftedPatch,
        ticket_title: draft.title || null,
        ticket_body: draft.descriptionMarkdown || null,
        share_id: shareId,
      })
      .eq("id", briefId);
    if (updErr) await admin.from("briefs").update(draftedPatch).eq("id", briefId);

    // Keep ALL media: export re-runs the full filing agent, which needs the
    // brief.json/keyframes/etc. Storage is cleaned up at filing time instead.
    return {
      ok: true,
      result: { ticketUrl: "", ticketIdentifier: "", summary: draft.title || "drafted" },
    };
  } catch (e: any) {
    await admin.from("briefs").update({ status: "failed", error: String(e?.message ?? e) }).eq("id", briefId);
    return { ok: false, status: 500, error: String(e?.message ?? e) };
  }
}
