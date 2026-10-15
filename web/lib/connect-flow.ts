// The browser side of Brief's own OAuth flows: where a flow may start from,
// where it may send the browser back to, and the cookie that ties a callback to
// the browser that started it. Shared by the /api/connect routes, since a
// route file may only export its handlers.

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { configuredOrigin, isOwnedProvider, type OwnedProvider } from "@/lib/connections";
import { readState, signState, type OAuthState } from "@/lib/oauth-state";
import { createAdminSupabase } from "@/lib/supabase/server";

/** The parts of a NextRequest these helpers read, so tests can pass a plain object. */
type RequestLike = {
  headers: Headers;
  nextUrl: { origin: string };
};

type CookieRequest = { cookies: { get(name: string): { value: string } | undefined } };

// ---------------------------------------------------------------------------
// Origin and return path
// ---------------------------------------------------------------------------

/**
 * The origin the provider sends the browser back to. Behind Fly's proxy the
 * request's own origin is the internal address, so APP_URL wins when it is a
 * usable http(s) URL. Start and callback both call this: providers compare the
 * redirect_uri of the token request with the one the flow started with, byte
 * for byte.
 */
export function appOrigin(req: { nextUrl: { origin: string } }): string {
  // An APP_URL that is not a usable URL falls back to the request's origin,
  // the next best thing.
  return configuredOrigin() ?? req.nextUrl.origin;
}

export const DEFAULT_RETURN = "/connections";

/** A path on this origin, and not one a browser reads as another host. */
const LOCAL_PATH = /^\/(?![/\\])/;

/**
 * Where to send the browser once the flow ends: only a path on this origin, so
 * the parameter cannot bounce someone off-site. The check runs on the
 * NORMALISED path, because dot segments collapse away: "/.//evil.example"
 * parses as a path on this origin and comes out as "//evil.example", which a
 * browser follows to another host.
 */
export function safeReturnTo(raw: string | null | undefined, origin: string): string {
  if (!raw || !raw.startsWith("/")) return DEFAULT_RETURN;
  try {
    const u = new URL(raw, origin);
    if (u.origin !== origin) return DEFAULT_RETURN;
    const path = `${u.pathname}${u.search}`;
    return LOCAL_PATH.test(path) ? path : DEFAULT_RETURN;
  } catch {
    return DEFAULT_RETURN;
  }
}

// ---------------------------------------------------------------------------
// Result URLs
// ---------------------------------------------------------------------------

/**
 * Why a connect flow ended without a connection. The page maps each code to
 * its own copy, so nothing from a provider or a query string is ever shown.
 */
export type ConnectError = "cancelled" | "failed" | "unavailable" | "no_org" | "no_workspace";

const RESULT_PARAMS = ["error", "provider", "connected", "pick"];

/** A clean landing URL: a returnTo carrying an earlier attempt's result loses it. */
function landing(origin: string, path: string): URL {
  const url = new URL(safeReturnTo(path, origin), origin);
  for (const k of RESULT_PARAMS) url.searchParams.delete(k);
  return url;
}

/** `?error=<code>&provider=<key>` on the return path. */
export function errorUrl(origin: string, returnTo: string, code: ConnectError, provider: OwnedProvider): URL {
  const url = landing(origin, returnTo);
  url.searchParams.set("error", code);
  url.searchParams.set("provider", provider);
  return url;
}

/** `?connected=<key>` on the return path. */
export function connectedUrl(origin: string, returnTo: string, provider: OwnedProvider): URL {
  const url = landing(origin, returnTo);
  url.searchParams.set("connected", provider);
  return url;
}

/** Connections, where the workspace picker lives, whatever the return path. */
export function pickUrl(origin: string, provider: OwnedProvider): URL {
  const url = landing(origin, DEFAULT_RETURN);
  url.searchParams.set("pick", provider);
  return url;
}

/** A 302 that is never cached, optionally setting cookies. */
export function redirectTo(url: URL, ...setCookies: string[]): Response {
  const headers = new Headers({ Location: url.toString(), "Cache-Control": "no-store" });
  for (const c of setCookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

// ---------------------------------------------------------------------------
// Request checks
// ---------------------------------------------------------------------------

/**
 * May this navigation start a flow? The session cookie is SameSite=Lax, so it
 * rides along on a top-level GET from any site, and with a provider that skips
 * the consent screen a link elsewhere could switch someone's tracker. A
 * navigation from the app itself, one the user typed (`none`), or one from a
 * sibling subdomain (`same-site`) passes: Clerk's session handshake runs on
 * clerk.<domain> and comes back to the start route from there. Only
 * `cross-site` is refused. No header at all is an older browser, which is let
 * through rather than locked out.
 */
export function isTrustedNavigation(req: RequestLike): boolean {
  return req.headers.get("sec-fetch-site") !== "cross-site";
}

/**
 * Is this request from a page on the app's own origin? The Origin header
 * decides when it carries one. A request made under a no-referrer policy sends
 * "null" instead, so that, like a missing header, falls back to
 * Sec-Fetch-Site, which a page cannot set.
 */
export function isSameOrigin(req: RequestLike, origin: string): boolean {
  const o = req.headers.get("origin");
  if (o && o !== "null") return o === origin;
  return req.headers.get("sec-fetch-site") === "same-origin";
}

export function isJsonRequest(req: RequestLike): boolean {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return type === "application/json";
}

// ---------------------------------------------------------------------------
// The flow cookie: one browser, one use
// ---------------------------------------------------------------------------

/**
 * A started flow, as the browser that started it holds it. The nonce is also
 * inside the signed state, so a callback only completes in the browser that
 * began it (a link carrying someone else's code and state is refused), and the
 * callback clears the cookie, so a state works once. The PKCE verifier lives
 * here too, never in a URL.
 */
export type Flow = { nonce: string; verifier?: string };

export const FLOW_COOKIE = "brief_connect";
const FLOW_COOKIE_PATH = "/api/connect";
/** Matches the signed state's lifetime. */
const FLOW_TTL_SECONDS = 15 * 60;

const B64URL = /^[A-Za-z0-9_-]+$/;

/**
 * PKCE where the provider supports it for a web app: Entra, Asana, GitLab,
 * Linear, GitHub, and monday, whose OAuth 2.1 flow refuses a code exchange
 * without it. Atlassian documents no PKCE for its 3LO flow, so Jira goes
 * without.
 */
const PKCE: ReadonlySet<OwnedProvider> = new Set<OwnedProvider>(["linear", "github", "gitlab", "azure", "asana", "monday"]);

export function usesPkce(provider: OwnedProvider): boolean {
  return PKCE.has(provider);
}

export function newFlow(provider: OwnedProvider): Flow {
  const nonce = randomBytes(24).toString("base64url");
  // 32 random bytes is a 43-character verifier, the shortest RFC 7636 allows.
  return usesPkce(provider) ? { nonce, verifier: randomBytes(32).toString("base64url") } : { nonce };
}

/** The S256 code challenge for a verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** Secure cookies whenever the app is served over https. */
export function secureCookies(origin: string): boolean {
  return origin.startsWith("https:");
}

function cookie(value: string, maxAge: number, secure: boolean): string {
  return [
    `${FLOW_COOKIE}=${value}`,
    `Path=${FLOW_COOKIE_PATH}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    // Lax, not Strict: the callback is a top-level navigation from the
    // provider's site, which Strict would strip the cookie from.
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function flowCookie(flow: Flow, secure: boolean): string {
  return cookie(flow.verifier ? `${flow.nonce}.${flow.verifier}` : flow.nonce, FLOW_TTL_SECONDS, secure);
}

export function clearFlowCookie(secure: boolean): string {
  return cookie("", 0, secure);
}

export function readFlowCookie(req: CookieRequest): Flow | null {
  const raw = req.cookies.get(FLOW_COOKIE)?.value;
  if (!raw) return null;
  const [nonce, verifier, extra] = raw.split(".");
  if (extra !== undefined || !nonce || !B64URL.test(nonce)) return null;
  if (verifier === undefined) return { nonce };
  return B64URL.test(verifier) ? { nonce, verifier } : null;
}

// ---------------------------------------------------------------------------
// Signed state
// ---------------------------------------------------------------------------

export type FlowState = OAuthState & { nonce: string };

/** Sign a state that carries the flow's nonce. */
export function signFlowState(state: Omit<FlowState, "ts">): string {
  // oauth-state signs every field it is given, so the nonce rides along.
  return signState(state);
}

/**
 * The signed state, only when it is for this provider, this signed-in user and
 * the flow this browser started. readState checks the signature and age, not
 * what the state is for.
 */
export function readFlowState(
  raw: string | null | undefined,
  provider: OwnedProvider,
  userId: string,
  flow: Flow | null,
): FlowState | null {
  const state = readState(raw) as FlowState | null;
  if (!state || !flow) return null;
  if (!isOwnedProvider(state.provider) || state.provider !== provider) return null;
  if (state.userId !== userId) return null;
  if (typeof state.nonce !== "string") return null;
  const a = Buffer.from(state.nonce);
  const b = Buffer.from(flow.nonce);
  return a.length === b.length && timingSafeEqual(a, b) ? state : null;
}

// ---------------------------------------------------------------------------
// Azure DevOps organizations
// ---------------------------------------------------------------------------

const VSSPS = "https://app.vssps.visualstudio.com";

/**
 * Did Azure DevOps really say this account has no organization? The adapter's
 * listAzureOrgs reads any failure as an empty list, which at connect time
 * would tell someone whose listing merely failed that they have none. This
 * asks the same two vssps questions and is true only when both were answered
 * and the list came back empty.
 */
export async function azureHasNoOrgs(authorization: string): Promise<boolean> {
  const get = async (path: string): Promise<unknown> => {
    const r = await fetch(`${VSSPS}${path}`, { headers: { Authorization: authorization, Accept: "application/json" } });
    // 203 is the sign-in page a rejected token gets instead of a 401.
    if (!r.ok || r.status === 203) throw new Error(`vssps answered ${r.status}`);
    return r.json();
  };
  try {
    const me = (await get("/_apis/profile/profiles/me?api-version=7.1")) as { id?: string } | null;
    if (!me?.id) return false;
    const accounts = (await get(`/_apis/accounts?memberId=${encodeURIComponent(me.id)}&api-version=7.1`)) as
      | { value?: unknown }
      | unknown[]
      | null;
    // Documented as Account[], served as { count, value }: accept either.
    const list = Array.isArray(accounts) ? accounts : accounts?.value;
    return Array.isArray(list) && list.length === 0;
  } catch (err) {
    // Status codes only (e.g. "vssps answered 401"): enough to tell a token
    // vssps refuses from an account that has never opened Azure DevOps.
    console.warn("[connect] azure organization check failed:", err instanceof Error ? err.message : "unknown error");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Org cache
// ---------------------------------------------------------------------------

/**
 * Drop the user's cached org_members row, so the next read resolves the org
 * again. The org comes from the tracker and its workspace pick, so connecting,
 * disconnecting or picking makes the cached row wrong. Best effort: the row
 * expires on its own TTL anyway.
 */
export async function forgetOrg(userId: string): Promise<void> {
  try {
    const { error } = await createAdminSupabase().from("org_members").delete().eq("user_id", userId);
    if (error) console.warn("[org] could not clear the cached org:", error.message);
  } catch (err) {
    console.warn("[org] could not clear the cached org:", err instanceof Error ? err.name : "unknown error");
  }
}
