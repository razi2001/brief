import { createAdminSupabase } from "@/lib/supabase/server";
import { selectDistinctFrames } from "@/lib/agent/frame-hash";
import { getLinearToken, makeLinearTracker } from "@/lib/linear";
import { getJiraAuth, getJiraCloud, makeJiraTracker } from "@/lib/jira";
import type { Tracker } from "@/lib/tracker";
import { processBrief, type BriefInput } from "@/lib/agent/process-brief";
import { transcribeAudio } from "@/lib/agent/transcribe";
import { mergeBriefOverrides, captionForScreenshot, type BriefOverrides } from "@/lib/agent/overrides";
import { getUserSettings } from "@/lib/settings";

export type ProcessResult =
  | { ok: true; result: { ticketUrl: string; ticketIdentifier: string; summary: string } }
  | { ok: false; status: number; error: string };

/**
 * Orchestrates filing a single brief: load the row (scoped to userId), resolve
 * the tracker (Linear preferred, Jira fallback), download media, run the agent,
 * mark the row 'filed' and delete media on success, or 'failed' on error.
 *
 * This is the shared core behind both the bearer-authed extension route
 * (POST /api/briefs/[id]/process) and the Clerk-authed dashboard retry route.
 * Behavior must remain identical to the original process route.
 */
export async function processBriefById(
  userId: string,
  briefId: string,
  opts: { includeVideo?: boolean; overrides?: BriefOverrides } = {},
): Promise<ProcessResult> {
  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs")
    .select("*")
    .eq("id", briefId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!brief) return { ok: false, status: 404, error: "not found" };

  // Resolve the tracker provider. Linear is the default/preferred provider; fall
  // back to Jira only if Linear isn't connected.
  let tracker: Tracker | null = null;
  const linearTok = await getLinearToken(userId);
  if (linearTok) {
    tracker = makeLinearTracker(linearTok);
  } else {
    const jiraTok = await getJiraAuth(userId);
    if (jiraTok) {
      const cloud = await getJiraCloud(jiraTok);
      if (cloud) tracker = makeJiraTracker(jiraTok, cloud);
    }
  }
  if (!tracker) {
    // Don't leave the row stuck in 'processing' (the process route flips it
    // before queueing this run) - fail it honestly with an actionable message
    // so the dashboard can show it with a Retry instead of a silent stall.
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

  // Account-level ticket guidance (Clerk privateMetadata), applied by the
  // agent. The reporter's role (from onboarding) rides along as light context.
  const { ticketGuidance, role } = await getUserSettings(userId);
  const guidance = [role ? `The reporter's role: ${role}.` : "", ticketGuidance]
    .filter(Boolean)
    .join("\n");

  await admin.from("briefs").update({ status: "processing" }).eq("id", briefId);
  try {
    // load brief.json + select keyframes (first/mid/last) + screenshot as data URLs
    const prefix = brief.storage_prefix as string;
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
    // server-side when the popup didn't give us one. Fail-soft: missing audio or
    // any API error leaves transcript null and the brief still files on visual +
    // console/network evidence.
    if (typeof json.transcript === "string" && json.transcript.trim()) {
      // already set by the merge - skip the OpenAI call
    } else {
      let audioInput: { bytes: Buffer; filename: string; contentType: string } | null = null;
      const audioBuf = await dl(`${prefix}/audio.webm`);
      if (audioBuf) {
        audioInput = { bytes: audioBuf, filename: "audio.webm", contentType: "audio/webm" };
      } else {
        // Older drafts (created before the audio track existed) only have the
        // video. Transcribe it directly when it's under OpenAI's 25 MB cap.
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

    // Whether to attach the actual video. This is the user's explicit "Attach
    // the recording to the ticket" toggle - OFF by default. The popup passes the
    // current value at file time; fall back to the (frozen) brief.json value,
    // then to false. When off, we still extract keyframe stills from the video
    // as the visual evidence so the ticket isn't left blind.
    const includeVideo = opts.includeVideo ?? !!json.includeVideo;

    // Keyframe timestamps from brief.json (filename → ms into the capture), so
    // each frame the model sees can be labelled with where it falls in the
    // recording (the storyboard) and the manifest can correlate them.
    const tsByFile = new Map<string, number>();
    for (const k of Array.isArray(json.keyframes) ? json.keyframes : []) {
      const file = String(k?.file ?? "").split("/").pop();
      if (file && typeof k?.timestamp === "number") tsByFile.set(file, k.timestamp);
    }

    // Collect keyframes. The recorder samples every 2s, so a mostly-static
    // screen yields many near-identical stills. Download all of them, then keep
    // only the frames where the screen ACTUALLY changed (perceptual de-dup),
    // capped to bound vision cost. Each kept frame goes to the model (vision,
    // as a timestamped storyboard) AND into the attachable evidence pool.
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

    // Keyframes always go to the model as a vision storyboard (so the ticket can
    // describe what the recording shows), but they are NOT attached to the ticket
    // as evidence stills here - a recording or the reporter's own screenshots make
    // the sampled frames redundant. They earn an attachment slot only when they're
    // the sole visual evidence (decided below, after we know what else exists).
    for (const f of frames) {
      images.push({
        name: f.name,
        dataUrl: `data:image/png;base64,${f.bytes.toString("base64")}`,
        timestampMs: f.timestampMs,
      });
    }

    // Screenshots: the popup uploads each as screenshots/<id>.png (multiple, each
    // with a user caption). Read them all; also accept a legacy top-level
    // screenshot.png. Each becomes a model image + attachable evidence with its
    // caption resolved from the (merged) brief.json screenshots[].
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

    // The recording is attachable ONLY when the user said so - when the toggle
    // is off we don't even download it. The manifest item still notes its
    // existence so the agent knows not to allude to it.
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

    // Keyframes earn an attachment slot only when there's nothing else to show:
    // no reporter screenshot AND the video itself isn't being attached. Otherwise
    // the sampled video stills are redundant clutter on the ticket.
    const recordingAttached = files.some((f) => f.filename === "recording.webm");
    const keyframesAsEvidence = !hasShot && !recordingAttached && frames.length > 0;
    if (keyframesAsEvidence) {
      for (const f of frames) {
        files.push({ filename: f.filename, contentType: "image/png", bytes: f.bytes });
        items.push({ name: f.filename, kind: "keyframe", timestampMs: f.timestampMs });
      }
    }

    // Default attachment set when the agent doesn't choose: EVERY screenshot the
    // reporter added (their explicit evidence), the recording when allowed, and -
    // only when keyframes are the sole visual evidence - a lean before/after pair.
    const fallback: string[] = [];
    for (const fn of shotFilenames) fallback.push(fn);
    if (recordingAttached) {
      fallback.push("recording.webm");
    } else if (keyframesAsEvidence) {
      const lean = frames.length <= 2 ? frames : [frames[0], frames[frames.length - 1]];
      for (const f of lean) fallback.push(f.filename);
    }

    console.log(
      `[process] brief ${briefId} via ${tracker.kind}: keyframes=${names.length} kept=${frames.length} kfAttached=${keyframesAsEvidence} screenshots=${shotFilenames.length} includeVideo=${includeVideo} attachable=${files.length} fallback=${fallback.length}`
    );

    const result = await processBrief(
      { json, images, evidence: { files, items, includeVideo, fallback } },
      tracker,
      guidance,
    );

    const filedPatch = {
      status: "filed",
      ticket_url: result.ticketUrl,
      ticket_identifier: result.ticketIdentifier,
      updated_at: new Date().toISOString(),
    };
    // Persist the real ticket title + initial state so the feed shows them
    // even when the live tracker sync can't run. Retry without the snapshot
    // columns if the DB predates migration 0004 - filing must never fail over
    // display data.
    const { error: updErr } = await admin
      .from("briefs")
      .update({
        ...filedPatch,
        ticket_title: result.ticketTitle || null,
        ticket_state_name: result.ticketState?.name ?? null,
        ticket_state_color: result.ticketState?.color ?? null,
      })
      .eq("id", briefId);
    if (updErr) await admin.from("briefs").update(filedPatch).eq("id", briefId);

    // delete media on success (keep the row)
    const toDelete: string[] = [
      `${prefix}/brief.json`, `${prefix}/recording.webm`, `${prefix}/audio.webm`, `${prefix}/screenshot.png`,
      ...shotPaths.map((p) => `${prefix}/${p}`),
      ...names.map((n) => `${prefix}/keyframes/${n}`),
    ];
    await admin.storage.from("briefs").remove(toDelete);

    return { ok: true, result };
  } catch (e: any) {
    await admin.from("briefs").update({ status: "failed", error: String(e?.message ?? e) }).eq("id", briefId);
    return { ok: false, status: 500, error: String(e?.message ?? e) };
  }
}
