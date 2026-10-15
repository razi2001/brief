import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { deleteConnection, isOwnedProvider } from "@/lib/connections";
import { appOrigin, forgetOrg, isSameOrigin } from "@/lib/connect-flow";
import { forgetWorkspaces } from "@/lib/workspaces";

/**
 * Drop a tracker connection Brief stores itself. Clerk-backed accounts are
 * removed by the Clerk client in the browser instead, so this only knows the
 * owned providers.
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

  // The org and the workspace lists came from this tracker, so they went with it.
  forgetWorkspaces(userId);
  await forgetOrg(userId);
  return Response.json({ ok: true });
}
