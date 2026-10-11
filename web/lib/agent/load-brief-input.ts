import { cleanUrl } from "@/lib/clean-url";
import { selectDistinctFrames } from "@/lib/agent/frame-hash";
import type { BriefInput } from "@/lib/agent/process-brief";
import { transcribeAudio, transcriptionHint } from "@/lib/agent/transcribe";
import { mergeBriefOverrides, captionForScreenshot, type BriefOverrides, type ReplayFrame } from "@/lib/agent/overrides";
import { techFromReplay, techFromRecording, isEmpty as isTechEmpty, type VideoLogs } from "@/lib/agent/tech-details";
import { summarizeReplay, type ReplaySummary } from "@/lib/agent/replay-steps";
import { findRecordingName, isRecordingName, isTranscribableRecording, recordingContentType, type RecordingName } from "@/lib/brief";
import type { BriefStore } from "./brief-store";

// Assembling what the ticket writers read from a brief's stored files. Reads
// through a BriefStore, so the ticket eval can feed it a folder.

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
  store: BriefStore,
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
  const dl = (p: string) => store.download(p);
  const briefJsonBuf = await dl(`${prefix}/brief.json`);
  const rawJson = briefJsonBuf ? JSON.parse(briefJsonBuf.toString("utf8")) : {};
  // The popup's edits (corrected transcript, per-shot notes, description, extra)
  // are authoritative over the capture-owned brief.json.
  const json = mergeBriefOverrides(rawJson, opts.overrides);
  // Page addresses without their tracking parameters (_gl, _ga, utm_…): the
  // agent copies them into the ticket, where they read as italic gibberish.
  if (typeof json.pageUrl === "string") json.pageUrl = cleanUrl(json.pageUrl);
  if (Array.isArray(json.events)) json.events = json.events.map((e) => (typeof e?.url === "string" ? { ...e, url: cleanUrl(e.url) } : e));
  // An attached replay (rrweb events) reaches the agent as plain steps (with
  // the URL at each), plus its stills and narration below.
  // A recording's capture events give the same details when there's no replay.
  {
    const tech = techFromRecording(json);
    if (!isTechEmpty(tech)) (json.techLogs ??= [] as VideoLogs[]).push({ label: "Screen recording", td: tech });
  }
  const replayBuf = await dl(`${prefix}/replay.json`);
  if (replayBuf) {
    try {
      const file = JSON.parse(replayBuf.toString("utf8"));
      // exact page trail, network calls and console, on the replay's clock
      const tech = techFromReplay(file);
      if (!isTechEmpty(tech) && json.includeReplay !== false) (json.techLogs ??= [] as VideoLogs[]).push({ label: "Replay", td: tech });
      json.replay = {
        ...summarizeReplay(file),
        frames: Array.isArray(file.frames) ? file.frames.map((f: { url?: string | null }) => ({ ...f, url: cleanUrl(f?.url) })) : [],
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
    recName = findRecordingName(await store.list(prefix));
  }

  // `lean` = export of an already-written ticket: skip transcription and the
  // keyframe vision storyboard (we're routing + attaching evidence, not
  // rewriting). This is what makes export fast - no Whisper, no keyframe
  // downloads, no vision tokens.
  let frames: Array<{ name: string; filename: string; timestampMs?: number; bytes: Buffer }> = [];

  // Always list the keyframes (cheap) so the caller can clean them up after
  // filing, even on a lean export that doesn't read them.
  const names = (await store.list(`${prefix}/keyframes`)).sort();

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
      const files = await store.list(`${prefix}/replay-frames`);
      const byFile = new Map((replayMeta.frames ?? []).map((f) => [f.file, f]));
      for (const o of [...files].sort().slice(0, 12)) {
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
  const shotMeta = Array.isArray(json.screenshots) ? json.screenshots : [];
  const shotPaths: string[] = [];
  for (const name of await store.list(`${prefix}/screenshots`)) shotPaths.push(`screenshots/${name}`);
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
    const stills = (await store.list(`${prefix}/replay-frames`)).sort().slice(0, 12);
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
