import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { deleteConnection, isOwnedProvider } from "@/lib/connections";
import { appOrigin, forgetOrg, isSameOrigin } from "@/lib/connect-flow";
import { removeClerkTrackers } from "@/lib/clerk-trackers";
import { forgetWorkspaces } from "@/lib/workspaces";
import { track } from "@/lib/events";

/**
 * Drop a tracker connection: the row Brief stores and, for Linear, Jira and
 * GitHub, the Clerk account the user may still have from before they moved to
 * Brief's own OAuth, which would otherwise keep filing as the fallback.
 *
 * `?clerk=keep` drops the row alone. A Clerk connect of the same tracker
 * sends it, so the account it has just started is not removed with the row it
 * replaces.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  // Only the app's own pages may disconnect a tracker; a form on another site
  // would otherwise ride the session cookie.
  if (!isSameOrigin(req, appOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwnedProvider(provider)) {
    return Response.json({ error: "unknown provider" }, { status: 404 });
  }

  try {
    await deleteConnection(userId, provider);
  } catch (err) {
    console.warn(
      `[connect] could not remove the ${provider} connection:`,
      err instanceof Error ? err.message : "unknown error",
    );
    return Response.json({ error: "failed" }, { status: 500 });
  }
  // After the row, so a Clerk outage can't stop a Brief-held connection from
  // going. Nothing to ask Clerk for the trackers that never had an account
  // there.
  const clerk = req.nextUrl.searchParams.get("clerk") === "keep" ? "done" : await removeClerkTrackers(userId, provider);

  // The org and the workspace lists came from this tracker, so they went with
  // it, even when its Clerk account is still there to retry.
  forgetWorkspaces(userId);
  await forgetOrg(userId);
  // A Clerk account that is still there keeps the tracker connected: one Clerk
  // refused to remove can be retried, and one kept as the user's only way to
  // sign in is left for the account page. When Clerk could not even be asked
  // (logged), the row is gone and the disconnect stands.
  if (clerk === "failed") return Response.json({ error: "failed" }, { status: 500 });
  if (clerk === "kept") return Response.json({ error: "failed" }, { status: 409 });
  track(userId, "tracker.disconnected", { provider });
  return Response.json({ ok: true });
}
