import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getGithubToken, listGithubOrgs } from "@/lib/github";
import { getPickedGithubOrg, setPickedGithubOrg } from "@/lib/org-server";

export const maxDuration = 60;

/**
 * The GitHub org picker.
 *
 * GitHub is the only tracker that has to ask. A Linear token belongs to exactly
 * one workspace and a Jira token to exactly one site, but a GitHub user is a
 * member of many orgs at once, so there is no "their" org to infer. Rather than
 * guess - and risk sharing someone's filing rules with the wrong company - we
 * list what their token can see and let them choose.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tok = await getGithubToken(userId);
  if (!tok) return NextResponse.json({ orgs: [], picked: null });

  const [orgs, picked] = await Promise.all([
    listGithubOrgs(tok),
    getPickedGithubOrg(userId),
  ]);
  return NextResponse.json({ orgs, picked });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  // setPickedGithubOrg re-checks membership against the live token: the org key
  // is what grants access to a shared leaderboard and shared preferences, so a
  // user must not be able to store one they don't belong to.
  const res = await setPickedGithubOrg(userId, String(body.login ?? ""));
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
