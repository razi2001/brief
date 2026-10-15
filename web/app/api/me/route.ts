import { NextRequest } from "next/server";
import { clerkClient, type User } from "@clerk/nextjs/server";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { providerName, trackerStatus } from "@/lib/trackers/registry";
import { corsPreflight, jsonCors } from "@/lib/cors";
import type { ProviderKey } from "@/lib/tracker";

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

  // The token row can outlive the Clerk account (account deleted/recreated).
  // A pairing to a dead user is dead: 401 so the extension drops it and
  // re-pairs with whoever is signed in now.
  let user: User;
  try {
    const client = await clerkClient();
    user = await client.users.getUser(userId);
  } catch {
    return jsonCors({ error: "unauthorized" }, { status: 401 });
  }

  // Which tracker the extension should name in its "Filing to X" copy, and
  // whether "Create ticket" can file at all. Resolved through the registry so
  // a new provider needs no change here; the user just fetched is handed over
  // so the registry only tries what is connected. With no tracker but a
  // connection that can't file yet, `trackerIssue` says why (a workspace still
  // to pick, an expired grant) instead of a plain "no tracker".
  let tracker: ProviderKey | null = null;
  let trackerIssue: string | null = null;
  try {
    ({ tracker, issue: trackerIssue } = await trackerStatus(userId, user));
  } catch {
    tracker = null;
    trackerIssue = null;
  }

  // The display name too, so the extension needs no table of its own to say
  // "Filing to Azure DevOps" for a tracker added after it shipped.
  const trackerName = tracker ? providerName(tracker) : null;

  return jsonCors({ ok: true, tracker, trackerName, trackerIssue });
}
