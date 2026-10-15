import { beforeEach, describe, expect, it, vi } from "vitest";

// getTrackerContext reads the signed-in Clerk user and the owned connection
// store; both are stood in for so the merge between them is what is tested.
const signedIn = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/clerk-user", () => ({
  getSignedInUser: async () => signedIn.current,
  getClerkUser: async () => signedIn.current,
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }), clerkClient: async () => null }));
const owned = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/connections", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/connections")>();
  return { ...mod, listConnectedProviders: owned.list };
});

import { getTrackerContext } from "@/lib/briefs-server";

beforeEach(() => {
  signedIn.current = null;
  owned.list.mockReset();
  owned.list.mockResolvedValue([]);
});

function user(externalAccounts: unknown[] = []) {
  return { id: "user_1", externalAccounts, privateMetadata: {}, firstName: "Ada" };
}

describe("getTrackerContext", () => {
  it("counts an owned connection as connected", async () => {
    signedIn.current = user();
    owned.list.mockResolvedValue(["asana"]);
    const ctx = await getTrackerContext();
    expect(ctx.connected).toEqual(["asana"]);
    expect(ctx.trackerConnected).toBe(true);
    expect(owned.list).toHaveBeenCalledWith("user_1");
  });

  it("merges Clerk accounts and owned connections in registry order", async () => {
    signedIn.current = user([{ provider: "oauth_atlassian" }, { provider: "oauth_github" }]);
    owned.list.mockResolvedValue(["monday", "notion", "azure"]);
    expect((await getTrackerContext()).connected).toEqual(["jira", "github", "azure", "notion", "monday"]);
  });

  it("reports nothing connected for a signed-out visitor, without asking the store", async () => {
    const ctx = await getTrackerContext();
    expect(ctx.connected).toEqual([]);
    expect(ctx.trackerConnected).toBe(false);
    expect(owned.list).not.toHaveBeenCalled();
  });
});
