export type SourceKind = "recording" | "screenshot" | "text" | "mix";

export interface BriefMeta {
  transcript?: string;
  keyframeCount?: number;
  hasScreenshot?: boolean;
  description?: string;
}

export function detectSourceKind(b: BriefMeta): SourceKind {
  const hasRecording = !!(b.keyframeCount && b.keyframeCount > 0) || !!b.transcript;
  const hasShot = !!b.hasScreenshot;
  const hasText = !!(b.description && b.description.trim());
  const kinds = [hasRecording, hasShot, hasText].filter(Boolean).length;
  if (kinds > 1) return "mix";
  if (hasRecording) return "recording";
  if (hasShot) return "screenshot";
  return "text";
}

// The recording sits at the brief's storage root as `recording.<ext>`. Captures
// made by the extension are always webm; a video the reporter uploaded keeps its
// own container (mp4 / mov), so every consumer resolves the name instead of
// assuming recording.webm.
export const RECORDING_NAMES = ["recording.webm", "recording.mp4", "recording.mov"] as const;
export type RecordingName = (typeof RECORDING_NAMES)[number];

const RECORDING_TYPES: Record<RecordingName, string> = {
  "recording.webm": "video/webm",
  "recording.mp4": "video/mp4",
  "recording.mov": "video/quicktime",
};

export function isRecordingName(name: unknown): name is RecordingName {
  return typeof name === "string" && (RECORDING_NAMES as readonly string[]).includes(name);
}

export function recordingContentType(name: RecordingName): string {
  return RECORDING_TYPES[name];
}

/** The recording among a brief's root object names (webm first), or null. */
export function findRecordingName(names: Iterable<string>): RecordingName | null {
  const set = new Set(names);
  for (const n of RECORDING_NAMES) if (set.has(n)) return n;
  return null;
}

/** Containers OpenAI's transcription endpoint decodes directly (not QuickTime). */
export function isTranscribableRecording(name: RecordingName): boolean {
  return name !== "recording.mov";
}
