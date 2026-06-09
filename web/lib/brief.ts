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
