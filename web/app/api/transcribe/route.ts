import { NextRequest } from "next/server";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { transcribeAudio } from "@/lib/agent/transcribe";
import { corsPreflight, jsonCors } from "@/lib/cors";

// Short voice notes from the popup are transcribed here with the same model the
// brief-filing agent uses. The audio is sent as the raw request body.
export const maxDuration = 60;

const EXT_BY_TYPE: Record<string, string> = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
};

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get("authorization"));
  const userId = token ? await userIdForToken(token) : null;
  if (!userId) return jsonCors({ error: "unauthorized" }, { status: 401 });

  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) return jsonCors({ error: "empty" }, { status: 400 });
  // OpenAI's transcription cap. A voice note this long would be unusual; reject
  // clearly rather than letting the upstream call fail opaquely.
  if (buf.length > 25 * 1024 * 1024) return jsonCors({ error: "too_large" }, { status: 413 });

  const contentType = req.headers.get("content-type") || "audio/webm";
  // OpenAI picks the decoder from the file EXTENSION, so name the upload after
  // its real container: voice notes are webm, but the extension also sends a
  // whole uploaded video (mp4) here to transcribe its narration.
  const ext = EXT_BY_TYPE[contentType.split(";")[0].trim().toLowerCase()] ?? "webm";
  // transcribeAudio is fail-soft (returns null on any error); surface that as an
  // empty string so the popup can show a friendly "didn't catch that".
  const text = await transcribeAudio({ bytes: buf, filename: `note.${ext}`, contentType });
  return jsonCors({ text: text || "" });
}
