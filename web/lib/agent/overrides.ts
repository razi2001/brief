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
  return base;
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
