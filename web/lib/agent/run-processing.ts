import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import { selectDistinctFrames } from "@/lib/agent/frame-hash";
import { getLinearToken, makeLinearTracker } from "@/lib/linear";
import { getJiraAuth, getJiraCloud, makeJiraTracker } from "@/lib/jira";
import type { Tracker } from "@/lib/tracker";
import { processBrief, type BriefInput } from "@/lib/agent/process-brief";
import { composeDraftTicket } from "@/lib/agent/compose-draft";
import { transcribeAudio } from "@/lib/agent/transcribe";
import { mergeBriefOverrides, captionForScreenshot, type BriefOverrides } from "@/lib/agent/overrides";
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
async function loadBriefInput(
  admin: SupabaseClient,
  prefix: string,
  opts: { includeVideo?: boolean; overrides?: BriefOverrides },
): Promise<{ input: BriefInput; names: string[]; includeVideo: boolean }> {
  const dl = async (p: string) => {
    const { data } = await admin.storage.from("briefs").download(p);
    return data ? Buffer.from(await data.arrayBuffer()) : null;
  };
  const briefJsonBuf = await dl(`${prefix}/brief.json`);
  const rawJson = briefJsonBuf ? JSON.parse(briefJsonBuf.toString("utf8")) : {};
  // The popup's edits (corrected transcript, per-shot notes, description, extra)
  // are authoritative over the capture-owned brief.json.
  const json = mergeBriefOverrides(rawJson, opts.overrides);

  // Use the supplied (edited) transcript when present; only transcribe
  // server-side when the popup didn't give us one. Fail-soft.
  if (typeof json.transcript === "string" && json.transcript.trim()) {
    // already set by the merge - skip the OpenAI call
  } else {
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
  }

  const images: BriefInput["images"] = [];
  const files: BriefInput["evidence"]["files"] = [];
  const items: BriefInput["evidence"]["items"] = [];

  const includeVideo = opts.includeVideo ?? !!json.includeVideo;

  // Keyframe timestamps (filename → ms into the capture) for the storyboard.
  const tsByFile = new Map<string, number>();
  for (const k of Array.isArray(json.keyframes) ? json.keyframes : []) {
    const file = String(k?.file ?? "").split("/").pop();
    if (file && typeof k?.timestamp === "number") tsByFile.set(file, k.timestamp);
  }

  // Keyframes: download all, keep only the perceptually-distinct ones (capped).
  const { data: kf } = await admin.storage.from("briefs").list(`${prefix}/keyframes`, { limit: 200 });
  const names = (kf ?? []).map((o) => o.name).sort();
  const downloaded = await Promise.all(
    names.map(async (n) => {
      const bytes = await dl(`${prefix}/keyframes/${n}`);
      const filename = n.split("/").pop() || n;
      return bytes ? { name: n, filename, timestampMs: tsByFile.get(filename), bytes } : null;
    }),
  );
  const frames = selectDistinctFrames(downloaded.filter((f): f is NonNullable<typeof f> => !!f));
  for (const f of frames) {
    images.push({
      name: f.name,
      dataUrl: `data:image/png;base64,${f.bytes.toString("base64")}`,
      timestampMs: f.timestampMs,
    });
  }

  // Screenshots: each uploaded as screenshots/<id>.png with a user caption; plus
  // a legacy top-level screenshot.png. Each becomes a model image + attachable
  // evidence with its caption resolved from the (merged) brief.json screenshots[].
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
    images.push({ name: rel, dataUrl: `data:image/png;base64,${b.toString("base64")}`, caption });
    files.push({ filename, contentType: "image/png", bytes: b });
    items.push({ name: filename, kind: "screenshot", caption });
    shotFilenames.push(filename);
  }
  const hasShot = shotFilenames.length > 0;

  // The recording is attachable ONLY when the user said so.
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

  // Keyframes earn an attachment slot only when there's nothing else to show.
  const recordingAttached = files.some((f) => f.filename === "recording.webm");
  const keyframesAsEvidence = !hasShot && !recordingAttached && frames.length > 0;
  if (keyframesAsEvidence) {
    for (const f of frames) {
      files.push({ filename: f.filename, contentType: "image/png", bytes: f.bytes });
      items.push({ name: f.filename, kind: "keyframe", timestampMs: f.timestampMs });
    }
  }

  // Default attachment set when the agent doesn't choose.
  const fallback: string[] = [];
  for (const fn of shotFilenames) fallback.push(fn);
  if (recordingAttached) {
    fallback.push("recording.webm");
  } else if (keyframesAsEvidence) {
    const lean = frames.length <= 2 ? frames : [frames[0], frames[frames.length - 1]];
    for (const f of lean) fallback.push(f.filename);
  }

  return {
    input: { json, images, evidence: { files, items, includeVideo, fallback } },
    names,
    includeVideo,
  };
}

/**
 * Orchestrates FILING a single brief: resolve the tracker, download media, run
 * the agent, mark the row 'filed' + clean up on success, or 'failed' on error.
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
  opts: { includeVideo?: boolean; overrides?: BriefOverrides; provider?: "linear" | "jira" } = {},
): Promise<ProcessResult> {
  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs")
    .select("*")
    .eq("id", briefId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!brief) return { ok: false, status: 404, error: "not found" };

  // Resolve the tracker. A pinned provider uses only that one (don't silently
  // file to the other). Otherwise Linear is preferred, Jira is the fallback.
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
    const { input, names, includeVideo } = await loadBriefInput(admin, prefix, {
      includeVideo: opts.includeVideo,
      overrides: opts.overrides,
    });

    console.log(
      `[process] brief ${briefId} via ${tracker.kind}: keyframes=${names.length} screenshots=${input.evidence.items.filter((i) => i.kind === "screenshot").length} includeVideo=${includeVideo} attachable=${input.evidence.files.length} fallback=${input.evidence.fallback.length}`,
    );

    const result = await processBrief(input, tracker, guidance);

    const filedPatch = {
      status: "filed",
      ticket_url: result.ticketUrl,
      ticket_identifier: result.ticketIdentifier,
      updated_at: new Date().toISOString(),
    };
    // Reuse the brief's share token if it has one (e.g. it was a draft) so the
    // public link stays stable across export; otherwise mint one.
    const shareId = (brief.share_id as string | null) || randomBytes(9).toString("base64url");
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

    // Clean up internal/large media, but KEEP the screenshots and (when the
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

  const guidance = await loadGuidance(userId);

  // 'processing' while the model writes (the page shows "writing the ticket…");
  // recoverOrphans only times out 'processing', never 'drafted'.
  await admin.from("briefs").update({ status: "processing" }).eq("id", briefId);
  try {
    const prefix = brief.storage_prefix as string;
    const { input } = await loadBriefInput(admin, prefix, { overrides: opts.overrides });
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
