import { beforeEach, describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Which trackers are connected, and the workspace each one picked: the two
// inputs org resolution takes for every tracker but Linear and Jira.
const registry = vi.hoisted(() => ({ connectedTrackers: vi.fn() }));
vi.mock("@/lib/trackers/registry", () => registry);
const workspaces = vi.hoisted(() => ({ getPickedWorkspace: vi.fn() }));
vi.mock("@/lib/workspaces", () => workspaces);

// Linear and Jira: what Brief's store holds for them (account_meta, or null for
// no connection), and the Clerk tokens from before their move to Brief's OAuth.
const trackers = vi.hoisted(() => ({
  readConnectionMeta: vi.fn(),
  linearToken: vi.fn(),
  getLinearOrg: vi.fn(),
  getJiraAuth: vi.fn(),
  getJiraCloud: vi.fn(),
}));
vi.mock("@/lib/connections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/connections")>()),
  readConnectionMeta: trackers.readConnectionMeta,
}));
vi.mock("@/lib/tracker-tokens", () => ({ linearToken: trackers.linearToken }));
vi.mock("@/lib/linear", () => ({ getLinearOrg: trackers.getLinearOrg }));
vi.mock("@/lib/jira", () => ({ getJiraAuth: trackers.getJiraAuth, getJiraCloud: trackers.getJiraCloud }));

import { setOrgSettings, getOrgSettings, getOrgMemberIds, getOrg } from "./org-server";

/**
 * A stub Supabase client. The real one RESOLVES with `{ error }` rather than
 * rejecting, which is exactly the behaviour these tests pin down: code that
 * only wraps a call in try/catch never learns that the write failed.
 */
function stubDb(result: { data?: unknown; error?: { message: string } | null }) {
  const settled = { data: result.data ?? null, error: result.error ?? null };
  const upsert = vi.fn().mockResolvedValue({ error: settled.error });
  // `.eq(...)` is both awaitable (getOrgMemberIds) and further chainable into
  // `.maybeSingle()` (getOrgSettings), which is how the real query builder
  // behaves - so the stub is a thenable that also carries maybeSingle.
  const eqResult = {
    maybeSingle: vi.fn().mockResolvedValue(settled),
    then: (resolve: (v: typeof settled) => unknown) => Promise.resolve(settled).then(resolve),
  };
  const eq = vi.fn(() => eqResult);
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ upsert, select }));
  return { db: { from } as unknown as SupabaseClient, upsert, from };
}

const BY = { userId: "user_1", name: "Razi" };

describe("setOrgSettings", () => {
  it("writes the guidance with its author", async () => {
    const { db, upsert } = stubDb({ error: null });
    await setOrgSettings("linear:abc", "Status: Backlog.", BY, db);

    expect(upsert).toHaveBeenCalledTimes(1);
    const row = upsert.mock.calls[0][0];
    expect(row.org_key).toBe("linear:abc");
    expect(row.ticket_guidance).toBe("Status: Backlog.");
    expect(row.updated_by).toBe("user_1");
    expect(row.updated_by_name).toBe("Razi");
  });

  it("throws when the write fails, rather than reporting a save that never happened", async () => {
    const { db } = stubDb({ error: { message: "permission denied" } });
    await expect(
      setOrgSettings("linear:abc", "Status: Backlog.", BY, db),
    ).rejects.toThrow("permission denied");
  });
});

describe("getOrgSettings", () => {
  it("reads the stored guidance and who last changed it", async () => {
    const { db } = stubDb({
      data: {
        ticket_guidance: "Status: Triage.",
        updated_by_name: "Jonas",
        updated_at: "2026-09-02T10:00:00.000Z",
      },
    });
    const s = await getOrgSettings("linear:abc", db);
    expect(s.ticketGuidance).toBe("Status: Triage.");
    expect(s.updatedByName).toBe("Jonas");
    expect(s.updatedAt).toBe("2026-09-02T10:00:00.000Z");
  });

  it("degrades to empty for an org nobody has configured", async () => {
    const { db } = stubDb({ data: null });
    const s = await getOrgSettings("linear:abc", db);
    // The agent still has to be able to file when there is no guidance.
    expect(s).toEqual({ ticketGuidance: "", updatedByName: "", updatedAt: null });
  });
});

describe("getOrgMemberIds", () => {
  it("returns the ids in the org", async () => {
    const { db } = stubDb({ data: [{ user_id: "a" }, { user_id: "b" }] });
    expect(await getOrgMemberIds("linear:abc", db)).toEqual(["a", "b"]);
  });

  it("returns nothing for an org with no cached members", async () => {
    const { db } = stubDb({ data: null });
    expect(await getOrgMemberIds("linear:abc", db)).toEqual([]);
  });
});

describe("getOrg from a workspace pick", () => {
  let n = 0;
  // getOrg is cached per render; a fresh user per test keeps them apart.
  const nextUser = () => `user_pick_${++n}`;

  it("puts a ClickUp user in the workspace they picked, and caches it", async () => {
    registry.connectedTrackers.mockResolvedValue(["clickup"]);
    workspaces.getPickedWorkspace.mockResolvedValue({ id: "9001", name: "Acme" });
    const { db, upsert } = stubDb({ data: null });
    const user = nextUser();

    expect(await getOrg(user, db)).toEqual({ key: "clickup:9001", name: "Acme", provider: "clickup" });
    expect(workspaces.getPickedWorkspace).toHaveBeenCalledWith(user, "clickup");
    expect(upsert.mock.calls[0][0]).toMatchObject({ user_id: user, org_key: "clickup:9001", provider: "clickup" });
  });

  it("keys a GitHub org case-insensitively", async () => {
    registry.connectedTrackers.mockResolvedValue(["github"]);
    workspaces.getPickedWorkspace.mockResolvedValue({ id: "Acme", name: "Acme" });
    const { db } = stubDb({ data: null });

    expect(await getOrg(nextUser(), db)).toMatchObject({ key: "github:acme", provider: "github" });
  });

  it("leaves someone with no pick out of every org", async () => {
    registry.connectedTrackers.mockResolvedValue(["gitlab"]);
    workspaces.getPickedWorkspace.mockResolvedValue(null);
    const { db, upsert } = stubDb({ data: null });

    expect(await getOrg(nextUser(), db)).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("keeps a GitHub user in the same org whether the pick came through Clerk or Brief", async () => {
    registry.connectedTrackers.mockResolvedValue(["github"]);
    // Clerk's privateMetadata spelled it one way, the Brief connection another.
    workspaces.getPickedWorkspace.mockResolvedValueOnce({ id: "Acme", name: "Acme" });
    const before = await getOrg(nextUser(), stubDb({ data: null }).db);
    workspaces.getPickedWorkspace.mockResolvedValueOnce({ id: "acme", name: "acme" });
    const after = await getOrg(nextUser(), stubDb({ data: null }).db);
    expect(after?.key).toBe(before?.key);
  });

  it("takes the first connected tracker with a pick, in registry order", async () => {
    registry.connectedTrackers.mockResolvedValue(["gitlab", "asana"]);
    workspaces.getPickedWorkspace.mockImplementation(async (_u: string, p: string) =>
      p === "asana" ? { id: "120", name: "Acme" } : null,
    );
    const { db } = stubDb({ data: null });

    expect(await getOrg(nextUser(), db)).toMatchObject({ key: "asana:120", provider: "asana" });
  });
});

describe("getOrg for Linear and Jira while they move off Clerk", () => {
  let n = 0;
  const nextUser = () => `user_move_${++n}`;

  beforeEach(() => {
    for (const fn of Object.values(trackers)) fn.mockReset();
    trackers.readConnectionMeta.mockResolvedValue(null);
  });

  it("keys a Linear user by the organization id, from a Clerk token or a Brief connection alike", async () => {
    registry.connectedTrackers.mockResolvedValue(["linear"]);
    trackers.linearToken.mockResolvedValue({ token: "clerk-linear" });
    trackers.getLinearOrg.mockResolvedValue({ id: "org-1", name: "Acme" });
    const onClerk = await getOrg(nextUser(), stubDb({ data: null }).db);
    expect(onClerk).toEqual({ key: "linear:org-1", name: "Acme", provider: "linear" });

    // Moved to Brief: the connect callback stored the same organization.
    trackers.getLinearOrg.mockClear();
    trackers.readConnectionMeta.mockResolvedValue({ workspaceId: "org-1", workspaceName: "Acme", label: "Ada" });
    const onBrief = await getOrg(nextUser(), stubDb({ data: null }).db);
    expect(onBrief?.key).toBe(onClerk?.key);
    // Read off the row: no Linear round trip.
    expect(trackers.getLinearOrg).not.toHaveBeenCalled();
  });

  it("asks a Brief-held Linear token when connect couldn't store the organization", async () => {
    registry.connectedTrackers.mockResolvedValue(["linear"]);
    trackers.readConnectionMeta.mockResolvedValue({ label: "Ada" });
    trackers.linearToken.mockResolvedValue({ token: "brief-linear" });
    trackers.getLinearOrg.mockResolvedValue({ id: "org-1", name: "Acme" });
    expect(await getOrg(nextUser(), stubDb({ data: null }).db)).toMatchObject({ key: "linear:org-1" });
    expect(trackers.getLinearOrg).toHaveBeenCalledWith({ token: "brief-linear" });
  });

  it("keys a Jira user by the site's cloud id: Clerk's first site, then the same site picked on Brief", async () => {
    registry.connectedTrackers.mockResolvedValue(["jira"]);
    trackers.getJiraAuth.mockResolvedValue({ token: "clerk-jira", kind: "oauth" });
    trackers.getJiraCloud.mockResolvedValue({ cloudId: "cloud-1", siteUrl: "https://acme.atlassian.net", name: "acme" });
    const onClerk = await getOrg(nextUser(), stubDb({ data: null }).db);
    expect(onClerk).toEqual({ key: "jira:cloud-1", name: "acme", provider: "jira" });

    trackers.getJiraAuth.mockClear();
    trackers.readConnectionMeta.mockResolvedValue({
      workspaceId: "cloud-1",
      workspaceName: "acme",
      siteUrl: "https://acme.atlassian.net",
    });
    const onBrief = await getOrg(nextUser(), stubDb({ data: null }).db);
    expect(onBrief?.key).toBe(onClerk?.key);
    expect(trackers.getJiraAuth).not.toHaveBeenCalled();
  });

  it("puts a Brief-held Jira with no site picked in no org, rather than guess its first site", async () => {
    registry.connectedTrackers.mockResolvedValue(["jira"]);
    trackers.readConnectionMeta.mockResolvedValue({});
    trackers.getJiraAuth.mockResolvedValue({ token: "clerk-jira", kind: "oauth" });
    trackers.getJiraCloud.mockResolvedValue({ cloudId: "cloud-1", siteUrl: "https://acme.atlassian.net" });
    const { db, upsert } = stubDb({ data: null });

    expect(await getOrg(nextUser(), db)).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
    expect(trackers.getJiraAuth).not.toHaveBeenCalled();
  });
});
