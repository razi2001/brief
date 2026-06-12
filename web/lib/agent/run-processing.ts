import { createHash } from "crypto";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getLinearToken, makeLinearTracker } from "@/lib/linear";
import { getJiraAuth, getJiraCloud, makeJiraTracker } from "@/lib/jira";
import type { Tracker } from "@/lib/tracker";
import { processBrief, type BriefInput } from "@/lib/agent/process-brief";
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
  opts: { includeVideo?: boolean } = {},
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
    const json = briefJsonBuf ? JSON.parse(briefJsonBuf.toString("utf8")) : {};

    const images: BriefInput["images"] = [];
    const files: BriefInput["evidence"]["files"] = [];
    const items: BriefInput["evidence"]["items"] = [];

    // Whether to attach the actual video. This is the user's explicit "Attach
    // the recording to the ticket" toggle - OFF by default. The popup passes the
    // current value at file time; fall back to the (frozen) brief.json value,
    // then to false. When off, we still extract keyframe stills from the video
    // as the visual evidence so the ticket isn't left blind.
    const includeVideo = opts.includeVideo ?? !!json.includeVideo;

    // Collect keyframes. Sample up to 8 evenly-spaced frames, then DROP exact
    // duplicates (a screen recording barely changes between samples, so naive
    // sampling yields near-identical stills). Every distinct frame goes to the
    // model (vision) AND into the attachable evidence pool - the agent picks
    // the minimal set that proves the issue via create_issue's attach[].
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

    // Keyframe timestamps from brief.json (filename → ms into the capture),
    // so the manifest lets the agent correlate frames with the narration.
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

    // A user-annotated screenshot is intentional, focused markup - always show
    // it to the model and make it attachable.
    const shot = await dl(`${prefix}/screenshot.png`);
    if (shot) {
      images.push({ name: "screenshot.png", dataUrl: `data:image/png;base64,${shot.toString("base64")}` });
      files.push({ filename: "screenshot.png", contentType: "image/png", bytes: shot });
      items.push({ name: "screenshot.png", kind: "screenshot" });
    }

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

    // Default attachment set when the agent doesn't choose - the old lean
    // heuristic: annotated shot, or the recording when allowed, else a
    // before/after frame pair.
    const fallback: string[] = [];
    if (shot) fallback.push("screenshot.png");
    if (includeVideo && files.some((f) => f.filename === "recording.webm")) {
      fallback.push("recording.webm");
    } else if (!shot && frames.length) {
      const lean = frames.length <= 2 ? frames : [frames[0], frames[frames.length - 1]];
      for (const f of lean) fallback.push(f.filename);
    }

    console.log(
      `[process] brief ${briefId} via ${tracker.kind}: frames=${names.length} distinct=${frames.length} screenshot=${!!shot} includeVideo=${includeVideo} attachable=${files.length} fallback=${fallback.length}`
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
    const toDelete: string[] = [`${prefix}/brief.json`, `${prefix}/recording.webm`, `${prefix}/screenshot.png`, ...names.map((n) => `${prefix}/keyframes/${n}`)];
    await admin.storage.from("briefs").remove(toDelete);

    return { ok: true, result };
  } catch (e: any) {
    await admin.from("briefs").update({ status: "failed", error: String(e?.message ?? e) }).eq("id", briefId);
    return { ok: false, status: 500, error: String(e?.message ?? e) };
  }
}
