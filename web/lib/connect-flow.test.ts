import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  orgDeletes: [] as string[],
  fail: null as { message: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      if (table !== "org_members") throw new Error(`unexpected table ${table}`);
      return {
        delete: () => ({
          eq: async (_col: string, userId: string) => {
            if (db.fail) return { error: db.fail };
            db.orgDeletes.push(userId);
            return { error: null };
          },
        }),
      };
    },
  }),
}));

import {
  FLOW_COOKIE,
  appOrigin,
  azureHasNoOrgs,
  clearFlowCookie,
  connectedUrl,
  errorUrl,
  flowCookie,
  forgetOrg,
  isJsonRequest,
  isSameOrigin,
  isTrustedNavigation,
  newFlow,
  pickUrl,
  pkceChallenge,
  readFlowCookie,
  readFlowState,
  redirectTo,
  safeReturnTo,
  secureCookies,
  signFlowState,
  usesPkce,
} from "@/lib/connect-flow";
import { signState } from "@/lib/oauth-state";

const ORIGIN = "http://localhost:3000";

const req = (headers: Record<string, string> = {}, path = "/api/connect/azure/start") =>
  new NextRequest(`${ORIGIN}${path}`, { headers });

beforeEach(() => {
  vi.stubEnv("CONNECTIONS_KEY", "test-signing-secret");
  vi.stubEnv("APP_URL", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  db.orgDeletes = [];
  db.fail = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("appOrigin", () => {
  it("uses the request's origin when APP_URL is unset", () => {
    expect(appOrigin(req())).toBe(ORIGIN);
  });

  it("reduces APP_URL to its origin", () => {
    vi.stubEnv("APP_URL", " https://cloud.example.com/some/path/// ");
    expect(appOrigin(req())).toBe("https://cloud.example.com");
  });

  it.each(["cloud.example.com", "javascript:alert(1)", "not a url"])(
    "ignores an APP_URL that is not an http(s) URL (%s)",
    (value) => {
      vi.stubEnv("APP_URL", value);
      expect(appOrigin(req())).toBe(ORIGIN);
    },
  );
});

describe("safeReturnTo", () => {
  it.each([
    "/.//evil.example",
    "/..//evil.example",
    "/%2e//evil.example",
    "/%2E%2E//evil.example",
    "/x/..//evil.example",
    "/x/../..//evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\\/evil.example",
    "https://evil.example/x",
    "javascript:alert(1)",
    "connections",
    "",
  ])("falls back to /connections for %s", (raw) => {
    const out = safeReturnTo(raw, ORIGIN);
    expect(out).toBe("/connections");
    // And whatever comes out stays on this origin when resolved.
    expect(new URL(out, ORIGIN).origin).toBe(ORIGIN);
  });

  it("keeps a path and query on this origin, without the fragment", () => {
    expect(safeReturnTo("/onboarding?step=2#top", ORIGIN)).toBe("/onboarding?step=2");
    expect(safeReturnTo("/a/./b/../c", ORIGIN)).toBe("/a/c");
  });

  it("falls back for null and undefined", () => {
    expect(safeReturnTo(null, ORIGIN)).toBe("/connections");
    expect(safeReturnTo(undefined, ORIGIN)).toBe("/connections");
  });
});

describe("result URLs", () => {
  it("puts the error code and provider on the return path", () => {
    const url = errorUrl(ORIGIN, "/onboarding?step=2", "no_org", "azure");
    expect(url.toString()).toBe(`${ORIGIN}/onboarding?step=2&error=no_org&provider=azure`);
  });

  it("drops an earlier attempt's result from the return path", () => {
    const url = connectedUrl(ORIGIN, "/connections?error=failed&provider=asana&pick=clickup&tab=1", "monday");
    expect(url.toString()).toBe(`${ORIGIN}/connections?tab=1&connected=monday`);
  });

  it("re-checks the return path, so a caller cannot send the browser off-site", () => {
    expect(errorUrl(ORIGIN, "/.//evil.example", "failed", "trello").origin).toBe(ORIGIN);
    expect(connectedUrl(ORIGIN, "//evil.example", "trello").pathname).toBe("/connections");
  });

  it("sends a pick to Connections", () => {
    expect(pickUrl(ORIGIN, "clickup").toString()).toBe(`${ORIGIN}/connections?pick=clickup`);
  });

  it("redirects with cookies and no caching", () => {
    const res = redirectTo(new URL(`${ORIGIN}/x`), "a=1", "b=2");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/x`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
  });
});

describe("request checks", () => {
  it.each([
    [{}, true],
    [{ "sec-fetch-site": "none" }, true],
    [{ "sec-fetch-site": "same-origin" }, true],
    // Clerk's session handshake comes back from clerk.<domain>.
    [{ "sec-fetch-site": "same-site" }, true],
    [{ "sec-fetch-site": "cross-site" }, false],
  ])("a start navigation with %j is trusted: %s", (headers, ok) => {
    expect(isTrustedNavigation(req(headers))).toBe(ok);
  });

  it.each([
    [{ origin: ORIGIN }, true],
    [{ origin: "https://evil.example" }, false],
    [{ origin: "https://evil.example", "sec-fetch-site": "same-origin" }, false],
    [{ origin: "null", "sec-fetch-site": "same-origin" }, true],
    [{ origin: "null", "sec-fetch-site": "cross-site" }, false],
    [{ "sec-fetch-site": "same-origin" }, true],
    [{ "sec-fetch-site": "same-site" }, false],
    [{}, false],
  ])("a request with %j is same-origin: %s", (headers, ok) => {
    expect(isSameOrigin(req(headers), ORIGIN)).toBe(ok);
  });

  it("compares the Origin header with the app origin, not the request's", () => {
    vi.stubEnv("APP_URL", "https://cloud.example.com");
    const r = req({ origin: "https://cloud.example.com" });
    expect(isSameOrigin(r, appOrigin(r))).toBe(true);
  });

  it.each([
    ["application/json", true],
    ["application/json; charset=utf-8", true],
    ["text/plain", false],
    ["application/x-www-form-urlencoded", false],
  ])("content type %s is JSON: %s", (type, ok) => {
    expect(isJsonRequest(req({ "content-type": type }))).toBe(ok);
  });
});

describe("flow cookie", () => {
  const cookieHeader = (setCookie: string) => setCookie.split(";")[0];

  it("is httpOnly, Lax, scoped to /api/connect and Secure only over https", () => {
    const flow = newFlow("clickup");
    const plain = flowCookie(flow, false);
    expect(plain).toMatch(new RegExp(`^${FLOW_COOKIE}=`));
    expect(plain).toContain("Path=/api/connect");
    expect(plain).toContain("HttpOnly");
    expect(plain).toContain("SameSite=Lax");
    expect(plain).toContain("Max-Age=900");
    expect(plain).not.toContain("Secure");
    expect(flowCookie(flow, true)).toContain("Secure");
    expect(secureCookies("https://cloud.example.com")).toBe(true);
    expect(secureCookies(ORIGIN)).toBe(false);
  });

  it("round-trips the nonce, and the verifier for a PKCE provider", () => {
    const plain = newFlow("clickup");
    expect(plain.verifier).toBeUndefined();
    expect(readFlowCookie(req({ cookie: cookieHeader(flowCookie(plain, false)) }))).toEqual(plain);

    const pkce = newFlow("asana");
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(readFlowCookie(req({ cookie: cookieHeader(flowCookie(pkce, false)) }))).toEqual(pkce);
  });

  it("clears with an empty value and no lifetime", () => {
    const c = clearFlowCookie(true);
    expect(c).toMatch(new RegExp(`^${FLOW_COOKIE}=;`));
    expect(c).toContain("Max-Age=0");
    expect(c).toContain("Path=/api/connect");
  });

  it.each(["", "a.b.c", "bad nonce", "ok.bad verifier!"])("reads %j as no flow", (value) => {
    expect(readFlowCookie(req({ cookie: `${FLOW_COOKIE}=${value}` }))).toBeNull();
  });

  it("is only used for PKCE on Azure DevOps, Asana, GitLab and monday", () => {
    for (const p of ["azure", "asana", "gitlab", "monday"] as const) expect(usesPkce(p)).toBe(true);
    for (const p of ["clickup", "notion", "trello"] as const) expect(usesPkce(p)).toBe(false);
  });

  it("derives the S256 challenge from the verifier", () => {
    // RFC 7636, appendix B.
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("flow state", () => {
  const flow = { nonce: "nonce_1" };
  const state = (over: Partial<{ userId: string; provider: "azure" | "trello"; nonce: string }> = {}) =>
    signFlowState({
      userId: over.userId ?? "user_1",
      provider: over.provider ?? "azure",
      returnTo: "/connections",
      nonce: over.nonce ?? "nonce_1",
    });

  it("reads back a state for this provider, user and browser", () => {
    expect(readFlowState(state(), "azure", "user_1", flow)).toMatchObject({
      userId: "user_1",
      provider: "azure",
      nonce: "nonce_1",
    });
  });

  it("refuses another provider, another user, another browser or no cookie", () => {
    expect(readFlowState(state(), "trello", "user_1", flow)).toBeNull();
    expect(readFlowState(state({ userId: "user_2" }), "azure", "user_1", flow)).toBeNull();
    expect(readFlowState(state({ nonce: "nonce_2" }), "azure", "user_1", flow)).toBeNull();
    expect(readFlowState(state(), "azure", "user_1", null)).toBeNull();
  });

  it("refuses a signed state with no nonce", () => {
    const old = signState({ userId: "user_1", provider: "azure", returnTo: "/connections" });
    expect(readFlowState(old, "azure", "user_1", flow)).toBeNull();
  });
});

describe("azureHasNoOrgs", () => {
  const PROFILE = "https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1";
  const ACCOUNTS = "https://app.vssps.visualstudio.com/_apis/accounts?memberId=m-1&api-version=7.1";

  function vssps(profile: [number, unknown], accounts: [number, unknown]) {
    const calls: Array<{ url: string; auth: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
        const [status, body] = url === PROFILE ? profile : url === ACCOUNTS ? accounts : [404, {}];
        return new Response(JSON.stringify(body), { status });
      }),
    );
    return calls;
  }

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["a bare array", []],
    ["a { count, value } page", { count: 0, value: [] }],
  ])("is true when both calls answer and the list is %s", async (_label, empty) => {
    const calls = vssps([200, { id: "m-1" }], [200, empty]);
    expect(await azureHasNoOrgs("Bearer tok")).toBe(true);
    expect(calls).toEqual([
      { url: PROFILE, auth: "Bearer tok" },
      { url: ACCOUNTS, auth: "Bearer tok" },
    ]);
  });

  it.each([
    ["the profile call fails", [500, {}], [200, []]],
    ["the profile has no id", [200, {}], [200, []]],
    ["the accounts call fails", [200, { id: "m-1" }], [503, {}]],
    ["the token gets the sign-in page", [203, {}], [200, []]],
    ["the account has an organization", [200, { id: "m-1" }], [200, { value: [{ accountName: "contoso" }] }]],
  ] as const)("is false when %s", async (_label, profile, accounts) => {
    vssps(profile as [number, unknown], accounts as [number, unknown]);
    expect(await azureHasNoOrgs("Bearer tok")).toBe(false);
  });

  it("is false when the network is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await azureHasNoOrgs("Bearer tok")).toBe(false);
  });
});

describe("forgetOrg", () => {
  it("deletes the user's cached org row", async () => {
    await forgetOrg("user_1");
    expect(db.orgDeletes).toEqual(["user_1"]);
  });

  it("logs and carries on when the delete fails", async () => {
    db.fail = { message: "db down" };
    await expect(forgetOrg("user_1")).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });
});
