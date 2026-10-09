// Evidence manifest + selection helpers for the filing agent. Pure functions,
// unit-tested in evidence.test.ts.
//
// The agent sees an explicit manifest of what evidence exists and chooses the
// minimal set to attach (create_issue's `attach` parameter). The recording is
// only ever attachable when the user's "attach the recording" toggle is on -
// that's a hard rule enforced upstream by simply not listing/loading it.

export type EvidenceKind = "keyframe" | "screenshot" | "recording" | "replay";

export interface EvidenceItem {
  name: string;
  kind: EvidenceKind;
  /** Position in the capture (keyframes), for correlating with the narration. */
  timestampMs?: number;
  /** User's note for a screenshot - their intent, surfaced to the agent. */
  caption?: string;
}

function fmtTs(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const KIND_LABEL: Record<EvidenceKind, string> = {
  keyframe: "screen frame",
  screenshot: "annotated screenshot",
  recording: "screen recording (video)",
  replay: "still from the replay",
};

/**
 * The text block describing the attachable evidence to the agent. Items of
 * kind "recording" are listed only when `includeVideo` is true; when one
 * exists but the user opted out, the agent is told not to attach or allude
 * to it.
 */
export function buildEvidenceManifest(items: EvidenceItem[], includeVideo: boolean): string {
  const attachable = items.filter((i) => i.kind !== "recording" || includeVideo);
  const excludedRecording = items.some((i) => i.kind === "recording") && !includeVideo;
  if (!attachable.length && !excludedRecording) return "";

  const lines = attachable.map((i) => {
    const ts = i.timestampMs !== undefined ? ` at ${fmtTs(i.timestampMs)}` : "";
    const cap = i.caption && i.caption.trim() ? ` - "${i.caption.trim()}"` : "";
    return `- ${i.name} (${KIND_LABEL[i.kind]}${ts})${cap}`;
  });
  const hasAttachableRecording = attachable.some((i) => i.kind === "recording");
  let text =
    "EVIDENCE AVAILABLE - choose what to attach via create_issue's `attach` parameter (file names from this list). " +
    (hasAttachableRecording
      ? "The screen recording (video) is the evidence the user explicitly asked to attach - you MUST include it in `attach`. Add the annotated screenshot as well if it highlights the issue; skip redundant near-identical frames.\n"
      : "Pick the minimal set that PROVES the issue: the annotated screenshot when there is one, otherwise the frame(s) showing the problem (e.g. a before/after pair). Skip near-identical frames.\n") +
    lines.join("\n");
  if (excludedRecording) {
    text +=
      "\nA screen recording exists but the user chose not to attach it - it is NOT attachable; do not attach or mention it.";
  }
  return text;
}

/**
 * Resolve the agent's `attach` selection against the attachable file names.
 * Unknown names are dropped; an empty/invalid/missing selection falls back to
 * the provided default set. De-dupes while preserving the agent's order.
 */
export function pickEvidence(
  attach: unknown,
  attachable: string[],
  fallback: string[],
): string[] {
  const valid = new Set(attachable);
  const wanted = Array.isArray(attach)
    ? [...new Set(attach.filter((n): n is string => typeof n === "string"))].filter((n) =>
        valid.has(n),
      )
    : [];
  return wanted.length ? wanted : fallback;
}
