import { NextRequest } from "next/server";
import { clerkClient, type User } from "@clerk/nextjs/server";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { CLERK_PROVIDERS, providerName, trackerStatus, type TrackerFix } from "@/lib/trackers/registry";
import { isOwnedProvider, isProviderConfigured, readConnection } from "@/lib/connections";
import { corsPreflight, jsonCors } from "@/lib/cors";
import type { ProviderKey } from "@/lib/tracker";
import { track } from "@/lib/events";
import { runningBashOf } from "@/lib/bash-server";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * Extension-facing account status: is this token still valid, and does the
 * account have a tracker connected? The popup calls it on open so "Create
 * ticket" can be gated BEFORE the user records and files - not after, via a
 * 409 from the process route. A 401 tells the extension to drop its cached
 * token (it belongs to a revoked pairing or a deleted account).
 * `trackerAction` says what the popup's Create button should offer instead:
 *  - with a tracker: "reconnect" for a reconnect filing does not need
 *    (actionFor), else null
 *  - with none: "pick" or "reconnect" for the connected tracker that can't
 *    file yet (named in `trackerName`), else "connect"
 * `bash` is the running bug bash the account is in, if any.
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
  // The popup asks this each time it opens.
  track(userId, "extension.opened");

  // Which tracker the extension should name in its "Filing to X" copy, and
  // whether "Create ticket" can file at all. Resolved through the registry so
  // a new provider needs no change here; the user just fetched is handed over
  // so the registry only tries what is connected. With no tracker but a
  // connection that can't file yet, `trackerIssue` says why (a workspace still
  // to pick, an expired grant) instead of a plain "no tracker".
  let tracker: ProviderKey | null = null;
  let trackerIssue: string | null = null;
  let fix: TrackerFix | null = null;
  try {
    ({ tracker, issue: trackerIssue, fix } = await trackerStatus(userId, user));
  } catch {
    tracker = null;
    trackerIssue = null;
    fix = null;
  }

  // The display name too, so the extension needs no table of its own to say
  // "Filing to Azure DevOps" for a tracker added after it shipped. With no
  // tracker, the name of the one to fix, if any.
  const named = tracker ?? fix?.key ?? null;
  const trackerName = named ? providerName(named) : null;

  const trackerAction = tracker ? await actionFor(userId, tracker) : (fix?.action ?? "connect");

  // The bug bash in which this person's own clock is running, so the popup can
  // show it with the time they have left and a switch to count a brief or not.
  // `hold` means a brief sent to it is kept as a draft for the review (no
  // tracker needed). `leftMs` is time left, not a clock time, so a computer
  // with a wrong clock still counts down right. Null when in none, and when it
  // can't be read: the popup then looks as it always did.
  const running = await runningBashOf(userId).catch(() => null);
  const bash = running ? { name: running.name, hold: running.hold, leftMs: Math.max(0, running.endsAt - Date.now()) } : null;

  return jsonCors({ ok: true, tracker, trackerName, trackerIssue, trackerAction, bash });
}

/**
 * "reconnect" when the tracker filed into is a Linear, Jira or GitHub still
 * held by its Clerk account (Brief has no row for it) and Brief's own app for
 * it is set up here: a reconnect moves it onto Brief's OAuth. Filing works
 * either way, so this is a nudge, never a block. A row that exists but can't
 * be read is not "absent", so a store hiccup never asks Brief-held users to
 * reconnect.
 */
async function actionFor(userId: string, tracker: ProviderKey): Promise<"reconnect" | null> {
  if (!CLERK_PROVIDERS.some((p) => p.key === tracker)) return null;
  if (!isOwnedProvider(tracker) || !isProviderConfigured(tracker)) return null;
  const read = await readConnection(userId, tracker).catch(() => null);
  return read?.state === "absent" ? "reconnect" : null;
}
