import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The extension's pairing token resolves to user_1; anything else is unknown.
vi.mock("@/lib/extauth", () => ({
  bearerFromHeader: (h: string | null) => (h?.startsWith("Bearer ") ? h.slice(7) : null),
  userIdForToken: async (token: string) => (token === "good" ? "user_1" : null),
}));

// The Clerk user the route fetches, and the token Clerk vends for its accounts.
const clerkUser = vi.hoisted(() => ({ current: { id: "user_1", externalAccounts: [] as unknown[] } }));
const oauthToken = vi.hoisted(() => ({ current: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: null }),
  clerkClient: async () => ({
    users: {
      getUser: async () => clerkUser.current,
      getUserOauthAccessToken: async () => ({
        data: oauthToken.current ? [{ token: oauthToken.current }] : [],
      }),
    },
  }),
}));

// The owned connection store.
const store = vi.hoisted(() => ({ current: {} as Record<string, { meta: Record<string, string> }> }));
vi.mock("@/lib/connections", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/connections")>();
  return {
    ...mod,
    isProviderConfigured: () => true,
    listConnectedProviders: async () => Object.keys(store.current),
    getConnection: async (_userId: string, provider: string) => {
      const row = store.current[provider];
      return row ? { provider, accessToken: `${provider}-token`, meta: row.meta } : null;
    },
    // Linear, Jira and GitHub ask whether there is a row at all before Clerk.
    readConnection: async (_userId: string, provider: string) => {
      const row = store.current[provider];
      return row
        ? { state: "connected", connection: { provider, accessToken: `${provider}-token`, meta: row.meta } }
        : { state: "absent" };
    },
  };
});

import { GET } from "./route";

function me(token = "good") {
  return GET(new NextRequest("http://localhost/api/me", { headers: { authorization: `Bearer ${token}` } }));
}

beforeEach(() => {
  clerkUser.current = { id: "user_1", externalAccounts: [] };
  oauthToken.current = null;
  store.current = {};
});

describe("/api/me", () => {
  it("names the tracker it files into, by its display name", async () => {
    store.current = { monday: { meta: {} } };
    expect(await (await me()).json()).toEqual({
      ok: true,
      tracker: "monday",
      trackerName: "Monday",
      trackerIssue: null,
    });
  });

  it("names a Clerk-backed tracker too", async () => {
    clerkUser.current = { id: "user_1", externalAccounts: [{ provider: "oauth_github" }] };
    oauthToken.current = "gh-token";
    const body = await (await me()).json();
    expect(body).toMatchObject({ tracker: "github", trackerName: "GitHub", trackerIssue: null });
  });

  it("says why there is no tracker when a connection is waiting on its workspace pick", async () => {
    store.current = { azure: { meta: {} } };
    expect(await (await me()).json()).toEqual({
      ok: true,
      tracker: null,
      trackerName: null,
      trackerIssue: "Pick your Azure DevOps organization under Settings, then retry.",
    });
  });

  it("says a connection expired when its token can't be had", async () => {
    clerkUser.current = { id: "user_1", externalAccounts: [{ provider: "oauth_linear" }] };
    const body = await (await me()).json();
    expect(body.tracker).toBeNull();
    expect(body.trackerIssue).toBe("Your Linear connection has expired - reconnect it under Settings, then retry.");
  });

  it("has nothing to explain when nothing is connected", async () => {
    expect(await (await me()).json()).toEqual({ ok: true, tracker: null, trackerName: null, trackerIssue: null });
  });

  it("refuses a token that pairs to no one", async () => {
    expect((await me("bad")).status).toBe(401);
  });
});
