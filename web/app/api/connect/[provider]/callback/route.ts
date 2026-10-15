import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import {
  OWNED_SPECS,
  deleteConnection,
  deleteOtherConnections,
  isOwnedProvider,
  isProviderConfigured,
  readConnectionMeta,
  redirectUri,
  requestToken,
  saveConnection,
  type OwnedProvider,
} from "@/lib/connections";
import {
  appOrigin,
  azureHasNoOrgs,
  clearFlowCookie,
  connectedUrl,
  DEFAULT_RETURN,
  errorUrl,
  forgetOrg,
  isJsonRequest,
  isSameOrigin,
  pickUrl,
  readFlowCookie,
  readFlowState,
  redirectTo,
  safeReturnTo,
  secureCookies,
  usesPkce,
  type ConnectError,
} from "@/lib/connect-flow";
import { CLERK_PROVIDERS } from "@/lib/trackers/registry";
import { forgetWorkspaces } from "@/lib/workspaces";
import { listGitlabGroups } from "@/lib/gitlab";
import { listAzureOrgs } from "@/lib/azure";
import { clickupAuthHeader, listClickUpWorkspaces } from "@/lib/clickup";
import { listTrelloWorkspaces } from "@/lib/trello";
import { listAsanaWorkspaces } from "@/lib/asana";
import { listMondayAccount } from "@/lib/monday";
import type { Workspace } from "@/lib/tracker";

type RouteCtx = { params: Promise<{ provider: string }> };

type Token = {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds?: number;
  /** The account's name, when the token reply carries it (Asana, Notion). */
  label?: string;
  /** The workspace the token was minted for, when the reply names it (Notion). */
  workspace?: Workspace;
};

/** Where the browser goes next, and why when nothing was stored. */
type Outcome = { url: URL; error?: ConnectError };

// ---------------------------------------------------------------------------
// GET - the provider's redirect lands here
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const { provider } = await ctx.params;
  if (!isOwnedProvider(provider)) {
    return Response.json({ error: "unknown provider" }, { status: 404 });
  }
  const origin = appOrigin(req);
  const search = req.nextUrl.searchParams;

  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const flow = readFlowCookie(req);
  const state = readFlowState(search.get("state"), provider, userId, flow);
  // A state that does not verify (expired included), belongs to another flow,
  // another user or another browser means this person did not start this
  // callback here. Refuse rather than attaching whatever token came with it,
  // and land on Connections rather than a bare error page. The cookie is left
  // alone, so a forged callback cannot cancel a real flow in progress.
  if (!state || !flow) return redirectTo(errorUrl(origin, DEFAULT_RETURN, "failed", provider));
  const returnTo = safeReturnTo(state.returnTo, origin);

  // Trello hands the token back in the URL fragment, which never reaches the
  // server. The relay page reads it in the browser and posts it to POST below,
  // which consumes the flow cookie; this page must leave it for that request.
  if (provider === "trello") {
    return new Response(TRELLO_RELAY, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": TRELLO_RELAY_CSP,
        // Not no-referrer: under that policy the relay's POST would carry
        // `Origin: null`, and the POST checks its origin.
        "Referrer-Policy": "same-origin",
      },
    });
  }

  // From here the flow is spent, whatever happens: a state works once.
  const clear = clearFlowCookie(secureCookies(origin));
  const fail = (code: ConnectError) => redirectTo(errorUrl(origin, returnTo, code, provider), clear);

  // The provider's own error text is not passed on: anyone can put anything in
  // this query string, so the page shows its own copy for a code.
  const denied = search.get("error");
  if (denied) return fail(denied === "access_denied" ? "cancelled" : "failed");

  const code = search.get("code");
  if (!code) return fail("failed");
  if (!isProviderConfigured(provider)) return fail("unavailable");
  if (usesPkce(provider) && !flow.verifier) return fail("failed");

  let token: Token | null;
  try {
    token = await exchangeCode(provider, code, redirectUri(origin, provider), flow.verifier);
  } catch (err) {
    // The name only: a JSON parse error's message quotes the response body,
    // which may hold a token.
    console.warn(`[connect] ${provider} token exchange failed:`, errorName(err));
    token = null;
  }
  if (!token) return fail("failed");

  try {
    const outcome = await finish(origin, userId, provider, returnTo, token);
    return redirectTo(outcome.url, clear);
  } catch (err) {
    console.warn(`[connect] could not store the ${provider} connection:`, errorName(err));
    return fail("failed");
  }
}

// ---------------------------------------------------------------------------
// POST - the Trello relay page posts the fragment token here
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { provider } = await ctx.params;
  if (provider !== "trello") return Response.json({ error: "not found" }, { status: 404 });
  const origin = appOrigin(req);

  // Only the relay page, on this origin, posts here. JSON is required because
  // a cross-site form cannot send it without a preflight.
  if (!isJsonRequest(req)) return Response.json({ error: "unsupported media type" }, { status: 415 });
  if (!isSameOrigin(req, origin)) return Response.json({ error: "forbidden" }, { status: 403 });

  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { token?: unknown; state?: unknown };
  const flow = readFlowCookie(req);
  const state = readFlowState(typeof body.state === "string" ? body.state : null, "trello", userId, flow);
  if (!state) {
    return Response.json(
      { error: "failed", redirect: relative(errorUrl(origin, DEFAULT_RETURN, "failed", "trello")) },
      { status: 400 },
    );
  }
  const returnTo = safeReturnTo(state.returnTo, origin);
  // The flow is spent from here, whatever happens.
  const headers = { "Set-Cookie": clearFlowCookie(secureCookies(origin)) };
  const refuse = (code: ConnectError, status: number) =>
    Response.json({ error: code, redirect: relative(errorUrl(origin, returnTo, code, "trello")) }, { status, headers });

  // Trello sends no token when the user declines. A token is a short opaque
  // string; anything else is not worth storing.
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 512 || /\s/.test(token)) return refuse("cancelled", 400);
  if (!isProviderConfigured("trello")) return refuse("unavailable", 400);

  try {
    // A token created with expiration=never has no refresh token and no expiry.
    const outcome = await finish(origin, userId, "trello", returnTo, { accessToken: token });
    if (outcome.error) return refuse(outcome.error, 400);
    return Response.json({ ok: true, redirect: relative(outcome.url) }, { headers });
  } catch (err) {
    console.warn("[connect] could not store the trello connection:", errorName(err));
    return refuse("failed", 500);
  }
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

/**
 * Trade the authorization code for a token. Null when the provider refuses or
 * returns no token. Asana's reply also carries the account (`data`), and
 * Notion's the user and the workspace the token was minted for, which saves a
 * profile call for each.
 */
async function exchangeCode(
  provider: OwnedProvider,
  code: string,
  callback: string,
  verifier: string | undefined,
): Promise<Token | null> {
  const spec = OWNED_SPECS[provider];
  const grant: Record<string, string> = spec.tokenBody
    ? spec.tokenBody({ code, redirectUri: callback })
    : {
        grant_type: "authorization_code",
        code,
        // Byte for byte the redirect_uri the flow started with, or the
        // provider refuses the exchange.
        redirect_uri: callback,
      };
  if (usesPkce(provider) && verifier) grant.code_verifier = verifier;

  const r = await requestToken(spec, grant);
  if (!r.ok) {
    // The status alone: a token endpoint's reply is not ours to print.
    console.warn(`[connect] ${provider} refused the code exchange: ${r.status}`);
    return null;
  }
  const j = (await r.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number | string;
    data?: { name?: string; email?: string };
    workspace_id?: string | null;
    workspace_name?: string | null;
    owner?: { user?: { name?: string | null } };
  };
  if (!j.access_token) return null;
  const expires = Number(j.expires_in);
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token || undefined,
    // Monday and ClickUp tokens do not expire and say nothing.
    expiresInSeconds: Number.isFinite(expires) && expires > 0 ? expires : undefined,
    // Notion's owner is the user who installed it; an integration a workspace
    // owns has no user, and the workspace names the card instead.
    label: j.data?.name || j.data?.email || j.owner?.user?.name || j.workspace_name || undefined,
    workspace: j.workspace_id ? { id: j.workspace_id, name: j.workspace_name || "Notion workspace" } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Account details, resolved once at connect time
// ---------------------------------------------------------------------------

/**
 * Every workspace the new token can see, through the adapter's own lister.
 * Notion's token is minted for one workspace, and the reply already named it.
 */
function listWorkspaces(provider: OwnedProvider, token: Token): Promise<Workspace[]> {
  const { accessToken } = token;
  switch (provider) {
    case "gitlab":
      return listGitlabGroups({ token: accessToken });
    case "notion":
      return Promise.resolve(token.workspace ? [token.workspace] : []);
    case "azure":
      return listAzureOrgs(`Bearer ${accessToken}`);
    case "clickup":
      return listClickUpWorkspaces(accessToken);
    case "trello":
      return listTrelloWorkspaces({ key: OWNED_SPECS.trello.clientId() ?? "", token: accessToken });
    case "asana":
      return listAsanaWorkspaces(accessToken);
    case "monday":
      return listMondayAccount({ token: accessToken });
  }
}

/**
 * The account's display name for the Connections card, plus any handle an
 * adapter wants later (the Trello member id). Best effort: a failure costs
 * the label (for Trello, the member id, which finish then refuses on).
 */
async function accountDetails(provider: OwnedProvider, accessToken: string): Promise<Record<string, string>> {
  const getJson = async <T>(url: string, init: RequestInit = {}): Promise<T | null> => {
    const r = await fetch(url, init);
    return r.ok ? ((await r.json()) as T) : null;
  };
  try {
    switch (provider) {
      case "gitlab": {
        const me = await getJson<{ name?: string; username?: string }>("https://gitlab.com/api/v4/user", {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        });
        return label(me?.name || me?.username);
      }
      case "azure": {
        const me = await getJson<{ displayName?: string; emailAddress?: string }>(
          "https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1",
          { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
        );
        return label(me?.displayName || me?.emailAddress);
      }
      case "clickup": {
        const j = await getJson<{ user?: { username?: string; email?: string } }>(
          "https://api.clickup.com/api/v2/user",
          { headers: { Authorization: clickupAuthHeader(accessToken) } },
        );
        return label(j?.user?.username || j?.user?.email);
      }
      case "trello": {
        const key = OWNED_SPECS.trello.clientId() ?? "";
        const j = await getJson<{ id?: string; username?: string; fullName?: string }>(
          `https://api.trello.com/1/members/me?fields=username,fullName&key=${encodeURIComponent(key)}&token=${encodeURIComponent(accessToken)}`,
        );
        return { ...(j?.id ? { memberId: j.id } : {}), ...label(j?.fullName || j?.username) };
      }
      case "monday": {
        const j = await getJson<{ data?: { me?: { name?: string; email?: string } } }>(
          "https://api.monday.com/v2",
          {
            method: "POST",
            // monday takes the bare token, with no "Bearer" scheme.
            headers: { Authorization: accessToken, "API-Version": "2025-04", "Content-Type": "application/json" },
            body: JSON.stringify({ query: "query { me { name email } }" }),
          },
        );
        return label(j?.data?.me?.name || j?.data?.me?.email);
      }
      case "asana":
      case "notion":
        // Already in the token reply.
        return {};
    }
  } catch (err) {
    console.warn(`[connect] could not read the ${provider} account:`, errorName(err));
    return {};
  }
}

function label(value: string | undefined): Record<string, string> {
  return value ? { label: value } : {};
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Store a new connection and make it the user's only tracker.
 *
 * One workspace is pinned straight away; several are left for the user to
 * pick on Connections. None is fine where filing needs no workspace (GitLab
 * files to personal projects too; the user just has no org). Some tokens are
 * refused before anything is stored, so the user keeps their current tracker:
 * Azure DevOps without an organization (there is no API host without one),
 * Asana without a workspace (every call is scoped to one), a Trello token
 * that cannot read its own member (it does not work, whatever the relay was
 * handed), and a Notion reply that names no workspace id (the id is the org
 * key, and a name alone is neither unique nor stable). A switch whose cleanup
 * fails is rolled back, so the user keeps their current tracker then too.
 */
async function finish(
  origin: string,
  userId: string,
  provider: OwnedProvider,
  returnTo: string,
  token: Token,
): Promise<Outcome> {
  const [workspaces, details] = await Promise.all([
    listWorkspaces(provider, token),
    accountDetails(provider, token.accessToken),
  ]);
  const refuse = (code: ConnectError): Outcome => ({ url: errorUrl(origin, returnTo, code, provider), error: code });
  // listAzureOrgs reads a failed listing as an empty one, and "no
  // organization" would send the user off to create one they already have.
  if (provider === "azure" && workspaces.length === 0) {
    return refuse((await azureHasNoOrgs(`Bearer ${token.accessToken}`)) ? "no_org" : "failed");
  }
  if (provider === "asana" && workspaces.length === 0) return refuse("no_workspace");
  if (provider === "trello" && !details.memberId) return refuse("failed");
  if (provider === "notion" && workspaces.length === 0) return refuse("failed");

  const meta: Record<string, string> = { ...details, ...label(token.label) };
  if (workspaces.length === 1) {
    meta.workspaceId = workspaces[0].id;
    meta.workspaceName = workspaces[0].name;
  }
  // A reconnect of the same tracker overwrites its row in place, so there is
  // no earlier row to fall back to and a rollback must not delete it.
  const reconnect = await readConnectionMeta(userId, provider).then(
    (m) => m !== null,
    () => false,
  );
  await saveConnection(userId, provider, {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresInSeconds: token.expiresInSeconds,
    meta,
  });

  const only = await makeOnlyTracker(userId, provider);
  // Either way the cached lists and org may belong to a tracker that is gone
  // now: a failed cleanup can still have removed part of it.
  forgetWorkspaces(userId);
  await forgetOrg(userId);
  if (!only) {
    // Registry order puts Linear, Jira and GitHub first, so a previous tracker
    // that survived the cleanup would keep winning while the card said the new
    // one was connected. Take the new one back out and say it failed.
    if (!reconnect) await rollBack(userId, provider);
    return refuse("failed");
  }

  if (workspaces.length > 1) return { url: pickUrl(origin, provider) };
  return { url: connectedUrl(origin, returnTo, provider) };
}

/**
 * Brief files into ONE tracker. Runs only after the save, so a failed connect
 * leaves the previous tracker in place. The browser removes nothing before an
 * owned flow starts, so this is where the previous tracker goes, Clerk-backed
 * ones included. False when anything could not be removed.
 *
 * Clerk goes first: it is the remote call more likely to fail, and a failure
 * there leaves every owned row as it was. The database just took the save, so
 * the owned delete after it rarely fails.
 */
async function makeOnlyTracker(userId: string, provider: OwnedProvider): Promise<boolean> {
  if (!(await dropClerkTrackers(userId))) return false;
  try {
    await deleteOtherConnections(userId, provider);
    return true;
  } catch (err) {
    console.warn("[connect] could not remove the other owned connections:", errorName(err));
    return false;
  }
}

/** Delete the connection just saved, after the switch to it failed. */
async function rollBack(userId: string, provider: OwnedProvider): Promise<void> {
  try {
    await deleteConnection(userId, provider);
  } catch (err) {
    console.warn(`[connect] could not roll back the ${provider} connection:`, errorName(err));
  }
}

/**
 * Remove the user's Clerk-connected tracker accounts (Linear, Jira, GitHub),
 * matched on each Clerk tracker's provider string. False when the user could
 * not be read or an account could not be removed.
 *
 * This relies on every Clerk tracker connection being connect-only
 * (`authenticatable: false`) on both Clerk instances, with Google the only
 * social sign-in: deleting one of these accounts can then never remove a way
 * to sign in. A tracker connection ever enabled for sign-in would break that.
 */
async function dropClerkTrackers(userId: string): Promise<boolean> {
  // An empty match would match every account, sign-in ones included.
  const matches = CLERK_PROVIDERS.map((d) => (d.clerkMatch ?? "").toLowerCase()).filter(Boolean);
  if (!matches.length) return true;
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const trackers = (user.externalAccounts ?? []).filter((a) => {
      const p = (a.provider ?? "").toLowerCase();
      return matches.some((m) => p.includes(m));
    });
    for (const account of trackers) {
      await client.users.deleteUserExternalAccount({ userId, externalAccountId: account.id });
    }
    return true;
  } catch (err) {
    console.warn("[connect] could not remove the Clerk tracker accounts:", errorName(err));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Path and query only, so the relay page can only navigate within the app. */
function relative(url: URL): string {
  return `${url.pathname}${url.search}`;
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown error";
}

// ---------------------------------------------------------------------------
// Trello relay page
// ---------------------------------------------------------------------------

/**
 * Trello's flow returns `#token=...`, and a fragment is never sent to the
 * server, so this page reads it in the browser and posts it back. The token
 * and state are wiped from the address bar first, so neither stays in history.
 * The server answers with where to go next, error or not, and the page only
 * follows a path on this origin. String.raw keeps the regex's backslashes as
 * written.
 */
const RELAY_SCRIPT = String.raw`(function () {
  var token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
  var state = new URLSearchParams(location.search).get("state") || "";
  history.replaceState(null, "", location.pathname);
  var fail = "/connections?error=failed&provider=trello";
  fetch(location.pathname, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: token, state: state })
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var next = data && typeof data.redirect === "string" && /^\/(?![\/\\])/.test(data.redirect) ? data.redirect : fail;
      location.replace(next);
    })
    .catch(function () { location.replace(fail); });
})();`;

const RELAY_STYLE = `body { font: 14px/1.5 system-ui, sans-serif; color: #3a352c; background: #fdfaf3; display: grid; place-items: center; height: 100vh; margin: 0; }`;

const sha256 = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;

/**
 * The page holds a live token for a moment, so it gets the strictest policy
 * that still runs: only its own script and style, and requests only to this
 * origin. Hashes rather than 'unsafe-inline', so the page keeps working if the
 * app ever adds a site-wide CSP.
 */
const TRELLO_RELAY_CSP = [
  "default-src 'none'",
  `script-src ${sha256(RELAY_SCRIPT)}`,
  `style-src ${sha256(RELAY_STYLE)}`,
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const TRELLO_RELAY = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connecting Trello</title>
<style>${RELAY_STYLE}</style>
</head>
<body>
<p>Connecting Trello</p>
<script>${RELAY_SCRIPT}</script>
</body>
</html>`;
