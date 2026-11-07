import { NextRequest } from "next/server";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { corsPreflight, jsonCors } from "@/lib/cors";
import { answerFor } from "@/lib/nudge-server";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * Extension-facing: the "Seen a bug?" card's text and the newest "show it now"
 * meant for this person (or everyone). A config pull like /api/replay-sites;
 * nothing about the user is recorded.
 */
export async function GET(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get("authorization"));
  const userId = token ? await userIdForToken(token) : null;
  if (!userId) return jsonCors({ error: "unauthorized" }, { status: 401 });
  return jsonCors(await answerFor(userId));
}
