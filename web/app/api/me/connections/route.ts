import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OWNED_PROVIDERS, isOwnedProvider, isProviderConfigured, type OwnedProvider } from "@/lib/connections";
import { appOrigin, clearErrorCookie, ERROR_COOKIE, readErrorCookie, secureCookies } from "@/lib/connect-flow";
import { explainFailure } from "@/lib/connect-errors";
import { createAdminSupabase } from "@/lib/supabase/server";

type OwnedConnection = {
  provider: OwnedProvider;
  /** The account's display name, when the provider gave one at connect time. */
  label: string | null;
  workspace: { id: string; name: string } | null;
};

/**
 * What the Connections page needs about the trackers Brief connects itself.
 * A Clerk connection from before Linear, Jira and GitHub moved to Brief's
 * OAuth is already on the user object in the browser.
 *
 *  - `owned`      what this user has connected, with its account and workspace
 *  - `configured` whether this DEPLOYMENT has credentials for each provider, so
 *                 the page can tell "not connected yet" apart from "not set up
 *                 here" and not offer a Connect button that can only fail. For
 *                 Linear, Jira and GitHub it also picks the flow: Brief's when
 *                 true, Clerk's otherwise
 *  - `lastError`  why the last connect failed, from the cookie the callback
 *                 set, explained (lib/connect-errors). Shown once: the cookie
 *                 is cleared in this same response
 *
 * Reads only the provider and account_meta columns: the token columns are
 * never selected, so they cannot end up in the response.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await createAdminSupabase()
    .from("tracker_connections")
    .select("provider, account_meta")
    .eq("user_id", userId);
  if (error) {
    // The error cookie is left for the next read, which may succeed.
    console.warn("[connections] could not list connections:", error.message);
    return Response.json({ error: "Could not load connections" }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{ provider: string; account_meta: Record<string, string> | null }>;
  const owned: OwnedConnection[] = rows
    .filter((r) => isOwnedProvider(r.provider))
    .map((r) => {
      const meta = r.account_meta ?? {};
      return {
        provider: r.provider as OwnedProvider,
        label: meta.label || null,
        // A missing name falls back to the id, so a card never shows a blank.
        workspace: meta.workspaceId ? { id: meta.workspaceId, name: meta.workspaceName || meta.workspaceId } : null,
      };
    })
    .sort((a, b) => OWNED_PROVIDERS.indexOf(a.provider) - OWNED_PROVIDERS.indexOf(b.provider));

  const configured = Object.fromEntries(
    OWNED_PROVIDERS.map((p) => [p, isProviderConfigured(p)]),
  ) as Record<OwnedProvider, boolean>;

  // A cookie that is forged, expired or another user's explains nothing, and
  // goes all the same.
  const failure = readErrorCookie(req, userId);
  const lastError = failure ? { provider: failure.provider, ...explainFailure(failure) } : null;
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (req.cookies.has(ERROR_COOKIE)) headers.append("Set-Cookie", clearErrorCookie(secureCookies(appOrigin(req))));

  return Response.json({ owned, configured, lastError }, { headers });
}
