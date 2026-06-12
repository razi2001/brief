import { NextRequest } from "next/server";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { getLinearToken } from "@/lib/linear";
import { getJiraAuth } from "@/lib/jira";
import { corsPreflight, jsonCors } from "@/lib/cors";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * Extension-facing account status: is this token still valid, and does the
 * account have a tracker connected? The popup calls it on open so "Create
 * ticket" can be gated BEFORE the user records and files - not after, via a
 * 409 from the process route. A 401 tells the extension to drop its cached
 * token (it belongs to a revoked pairing or a deleted account).
 */
export async function GET(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get("authorization"));
  const userId = token ? await userIdForToken(token) : null;
  if (!userId) return jsonCors({ error: "unauthorized" }, { status: 401 });

  let tracker: "linear" | "jira" | null = null;
  try {
    if (await getLinearToken(userId)) tracker = "linear";
    else if (await getJiraAuth(userId)) tracker = "jira";
  } catch {
    tracker = null;
  }

  return jsonCors({ ok: true, tracker });
}
