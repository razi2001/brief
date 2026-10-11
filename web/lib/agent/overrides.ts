// User-editable brief metadata supplied at FILE time (popup), authoritative over
// the capture-owned brief.json. Kept pure + unit-tested; run-processing applies it.

export interface ScreenshotMeta {
  file: string;
  description?: string;
  annotated?: boolean;
}
export interface BriefOverrides {
  title?: string;
  includeVideo?: boolean;
  transcript?: string;
  description?: string;
  extra?: Array<{ key: string; value: string }>;
  screenshots?: ScreenshotMeta[];
  /** The replay: kept on the brief (true) or only used for the write-up. */
  includeReplay?: boolean;
  replayNote?: string;
  /** Where the reporter marked the bug in the recording (ms into it). */
  recordingMarks?: Array<{ t: number; note?: string }>;
  /** A trimmed recording: the part of the original capture it keeps (ms). */
  recordingTrim?: { a: number; b: number };
}

/** Overlay the user's latest edits onto parsed brief.json without mutating it.
 *  Only non-empty / present fields win; capture data (events, keyframes...) is kept. */
export function mergeBriefOverrides(json: unknown, overrides: BriefOverrides | null | undefined) {
  const base: Record<string, any> = json && typeof json === "object" ? { ...(json as object) } : {};
  if (!overrides || typeof overrides !== "object") return base;
  if (typeof overrides.transcript === "string" && overrides.transcript.trim()) base.transcript = overrides.transcript;
  if (typeof overrides.description === "string") base.description = overrides.description;
  if (Array.isArray(overrides.extra)) base.extra = overrides.extra;
  if (Array.isArray(overrides.screenshots)) base.screenshots = overrides.screenshots;
  if (typeof overrides.includeReplay === "boolean") base.includeReplay = overrides.includeReplay;
  if (typeof overrides.replayNote === "string") base.replayNote = overrides.replayNote;
  if (Array.isArray(overrides.recordingMarks)) {
    base.recordingMarks = overrides.recordingMarks
      .filter((m) => m && typeof m.t === "number" && isFinite(m.t) && m.t >= 0)
      .slice(0, 20)
      .map((m) => ({ t: m.t, note: typeof m.note === "string" ? m.note.slice(0, 300) : "" }));
  }
  // The recording was trimmed after capture: its event log (clicks, network,
  // console, the page at each moment) is on the original clock. Keep what
  // happened in the kept part, on the trimmed video's clock - so the logs, the
  // page URL under each frame and the agent all line up with what plays.
  const trim = overrides.recordingTrim;
  if (trim && isFinite(trim.a) && isFinite(trim.b) && trim.b > trim.a && trim.a >= 0 && Array.isArray(base.events)) {
    base.events = trimEvents(base.events, trim);
  }
  return base;
}

/** Events within [a, b] of the capture, re-timed to start at a. Events with no time are kept. */
export function trimEvents(events: unknown[], { a, b }: { a: number; b: number }): unknown[] {
  const out: unknown[] = [];
  for (const e of events) {
    const t = (e as { tMs?: unknown })?.tMs;
    if (typeof t !== "number" || !isFinite(t)) { out.push(e); continue; }
    if (t < a || t > b) continue;
    out.push({ ...(e as object), tMs: t - a });
  }
  return out;
}

const baseName = (p: string) => String(p ?? "").split("/").pop() || String(p ?? "");

/** Find a screenshot's caption by basename, tolerating dir prefixes on either side. */
export function captionForScreenshot(file: string, shots: ScreenshotMeta[] | undefined): string | undefined {
  if (!Array.isArray(shots)) return undefined;
  const want = baseName(file);
  const hit = shots.find((s) => baseName(s.file) === want);
  const d = hit?.description;
  return typeof d === "string" && d.trim() ? d.trim() : undefined;
}
