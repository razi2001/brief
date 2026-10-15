import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { appOrigin, isSameOrigin } from "@/lib/connect-flow";
import {
  getPickedWorkspace,
  hasWorkspacePick,
  listWorkspaces,
  setPickedWorkspace,
} from "@/lib/workspaces";

// Listing a GitHub user's orgs walks pages of repos, which can take seconds.
export const maxDuration = 60;

/**
 * The workspace pick, for every tracker that has one.
 *
 * A Linear token belongs to exactly one workspace and a Jira token to exactly
 * one site, so those two never ask and get a 400 here. Everything else can see
 * several, and rather than guess (and risk sharing someone's filing rules with
 * the wrong company) we list what their token can see and let them choose.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const provider = req.nextUrl.searchParams.get("provider") ?? "";
  if (!hasWorkspacePick(provider)) {
    return NextResponse.json({ error: "unknown provider" }, { status: 400 });
  }

  const [workspaces, picked] = await Promise.all([
    listWorkspaces(userId, provider),
    getPickedWorkspace(userId, provider),
  ]);
  return NextResponse.json({ workspaces, picked });
}

export async function POST(req: NextRequest) {
  // Only the app's own pages may change the pick; a form on another site
  // would otherwise ride the session cookie and move someone into its org.
  if (!isSameOrigin(req, appOrigin(req))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const provider = String(body.provider ?? "");
  if (!hasWorkspacePick(provider)) {
    return NextResponse.json({ error: "unknown provider" }, { status: 400 });
  }

  // setPickedWorkspace re-checks the id against the live token: the org key is
  // what grants access to a shared leaderboard and shared preferences, so a
  // user must not be able to store a workspace they can't see.
  const res = await setPickedWorkspace(userId, provider, String(body.id ?? ""));
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
