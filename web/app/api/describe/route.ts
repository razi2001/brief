import { NextRequest } from "next/server";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { describeNarration } from "@/lib/agent/describe-narration";
import { corsPreflight, jsonCors } from "@/lib/cors";

// The description the popup pre-fills, written from a recording's transcript
// (sent as JSON { text }). Its own call, after /api/transcribe: the transcript
// reaches the popup without waiting for it.
export const maxDuration = 30;

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get("authorization"));
  const userId = token ? await userIdForToken(token) : null;
  if (!userId) return jsonCors({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  // describeNarration is fail-soft (null on any error or NONE): an empty
  // description just leaves the field to the reporter.
  const description = text ? await describeNarration(text) : null;
  return jsonCors({ description: description || "" });
}
