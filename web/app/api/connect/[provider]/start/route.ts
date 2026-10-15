import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OWNED_SPECS, isOwnedProvider, isProviderConfigured, redirectUri } from "@/lib/connections";
import {
  appOrigin,
  DEFAULT_RETURN,
  errorUrl,
  flowCookie,
  isTrustedNavigation,
  newFlow,
  pkceChallenge,
  redirectTo,
  safeReturnTo,
  secureCookies,
  signFlowState,
} from "@/lib/connect-flow";

/**
 * Begin the OAuth flow for a tracker whose token Brief stores itself (GitLab,
 * Azure DevOps, ClickUp, Notion, Trello, Asana, Monday). Clerk-backed trackers
 * never reach here: the browser talks to Clerk directly for those.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwnedProvider(provider)) {
    return Response.json({ error: "unknown provider" }, { status: 404 });
  }

  const origin = appOrigin(req);
  // A link on another site must not be able to start a flow that, with a
  // provider that skips its consent screen, swaps this user's tracker.
  if (!isTrustedNavigation(req)) return redirectTo(new URL(DEFAULT_RETURN, origin));

  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"), origin);
  // Checked before leaving for the provider: a missing CONNECTIONS_KEY would
  // otherwise only fail after the user has granted access, when the token
  // cannot be stored.
  if (!isProviderConfigured(provider)) {
    return redirectTo(errorUrl(origin, returnTo, "unavailable", provider));
  }

  const spec = OWNED_SPECS[provider];
  const clientId = spec.clientId() ?? "";
  const flow = newFlow(provider);
  // Signed, so an attacker cannot forge one for someone else's account, and
  // carrying the nonce from the cookie set below, so it only completes in this
  // browser.
  const state = signFlowState({ userId, provider, returnTo, nonce: flow.nonce });
  const callback = redirectUri(origin, provider);

  const url = new URL(spec.authorizeUrl);
  const params = url.searchParams;
  if (provider === "trello") {
    // Trello is not OAuth 2.0: it takes the API key as `key`, has no `state`
    // parameter, and returns the token in the fragment of `return_url`. The
    // state rides in that URL's query instead, which Trello leaves alone.
    params.set("key", clientId);
    params.set("return_url", `${callback}?state=${encodeURIComponent(state)}`);
    params.set("callback_method", "fragment");
  } else {
    params.set("client_id", clientId);
    params.set("redirect_uri", callback);
    params.set("response_type", "code");
    params.set("state", state);
  }
  // An empty scope means the provider takes none (ClickUp, Notion) or uses what
  // its app registration grants (Asana); an empty param is not the same as none
  // to every provider.
  if (spec.scope) params.set("scope", spec.scope);
  if (flow.verifier) {
    params.set("code_challenge", pkceChallenge(flow.verifier));
    params.set("code_challenge_method", "S256");
  }
  // Microsoft otherwise signs in silently with whichever account the browser
  // last used, which is often a work account that is not the one with the
  // Azure DevOps organization.
  if (provider === "azure") params.set("prompt", "select_account");
  for (const [k, v] of Object.entries(spec.authorizeExtra ?? {})) params.set(k, v);

  return redirectTo(url, flowCookie(flow, secureCookies(origin)));
}
