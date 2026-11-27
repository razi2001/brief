import { RECORDING_NAMES, type RecordingName } from "@/lib/brief";

/**
 * Files the owner adds to a draft from the Attachments section: images become
 * screenshots (converted to PNG in the browser, the one format the whole
 * evidence pipeline reads), and a video becomes the draft's recording, in its
 * own container. Shared by the upload route and the button.
 */

/** Supabase's per-object cap: the same ceiling the extension's uploads live under. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const IMAGE_ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const VIDEO_NAME: Record<string, RecordingName> = {
  "video/webm": "recording.webm",
  "video/mp4": "recording.mp4",
  "video/quicktime": "recording.mov",
};
export const VIDEO_ACCEPT = Object.keys(VIDEO_NAME);

/** The recording name a video's type is stored under, or null if we can't take it. */
export function recordingNameFor(type: string): RecordingName | null {
  return VIDEO_NAME[type.split(";")[0].trim().toLowerCase()] ?? null;
}

/** A fresh, collision-free screenshot path (the evidence routes only serve `screenshots/*.png`). */
export function uploadedShotPath(n: number, now = Date.now()): string {
  return `screenshots/upload-${now}-${n}.png`;
}

/** What the route accepts as an upload target: an uploaded screenshot, or a recording. */
export function isUploadPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    (/^screenshots\/upload-\d+-\d+\.png$/.test(path) || (RECORDING_NAMES as readonly string[]).includes(path))
  );
}
