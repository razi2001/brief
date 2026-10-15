import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Clerk: the per-render user read (getClerkUser) and the client used to write
// GitHub's pick (updateUserMetadata).
const clerk = vi.hoisted(() => ({
  updateUserMetadata: vi.fn<
    (userId: string, params: { privateMetadata: Record<string, unknown> }) => Promise<unknown>
  >(async () => ({})),
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ users: clerk }),
}));
vi.mock("@/lib/clerk-user", () => ({ getClerkUser: vi.fn() }));

// org_members, which a pick clears so the new org shows at once.
const db = vi.hoisted(() => {
  const eq = vi.fn(async () => ({ error: null }));
  const del = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ delete: del }));
  return { eq, del, from };
});
vi.mock("@/lib/supabase/server", () => ({ createAdminSupabase: () => ({ from: db.from }) }));

// The owned store: the real connectionWorkspace, a stand-in for the rest.
vi.mock("@/lib/connections", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/connections")>();
  return {
    ...mod,
    getConnection: vi.fn(),
    readConnectionMeta: vi.fn(),
    setConnectionMeta: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/github", () => ({ getGithubToken: vi.fn(), listGithubOrgs: vi.fn() }));
vi.mock("@/lib/gitlab", () => ({ listGitlabGroups: vi.fn() }));
vi.mock("@/lib/notion", () => ({ listNotionWorkspaces: vi.fn() }));
vi.mock("@/lib/azure", () => ({ listAzureOrgs: vi.fn() }));
vi.mock("@/lib/clickup", () => ({ listClickUpWorkspaces: vi.fn() }));
vi.mock("@/lib/trello", () => ({ listTrelloWorkspaces: vi.fn() }));
vi.mock("@/lib/asana", () => ({ listAsanaWorkspaces: vi.fn() }));
vi.mock("@/lib/monday", () => ({ listMondayAccount: vi.fn() }));

import {
  WORKSPACE_NOUN,
  forgetWorkspaces,
  getPickedWorkspace,
  hasWorkspacePick,
  listWorkspaces,
  setPickedWorkspace,
  workspacesToPick,
} from "./workspaces";
import { getClerkUser } from "@/lib/clerk-user";
import {
  getConnection,
  readConnectionMeta,
  setConnectionMeta,
  type Connection,
  type OwnedProvider,
} from "@/lib/connections";
import { getGithubToken, listGithubOrgs } from "@/lib/github";
import { listGitlabGroups } from "@/lib/gitlab";
import { listNotionWorkspaces } from "@/lib/notion";
import { listAzureOrgs } from "@/lib/azure";
import { listClickUpWorkspaces } from "@/lib/clickup";
import { listTrelloWorkspaces } from "@/lib/trello";
import { listAsanaWorkspaces } from "@/lib/asana";
import { listMondayAccount } from "@/lib/monday";

// The listing is remembered per user for five minutes, so every test gets its
// own user rather than inheriting another test's answer.
let n = 0;
let user = "";
beforeEach(() => {
  user = `user_${++n}`;
});

/** The Clerk user's privateMetadata, as getClerkUser returns it. */
let meta: Record<string, unknown> = {};
/** Owned connections the store holds for the current user. */
let store: Partial<Record<OwnedProvider, Connection>> = {};

beforeEach(() => {
  meta = {};
  store = {};
  vi.mocked(getClerkUser).mockImplementation(
    async () => ({ privateMetadata: meta }) as unknown as Awaited<ReturnType<typeof getClerkUser>>,
  );
  vi.mocked(getConnection).mockImplementation(async (_u, p) => store[p] ?? null);
  vi.mocked(readConnectionMeta).mockImplementation(async (_u, p) => store[p]?.meta ?? null);
  vi.mocked(getGithubToken).mockResolvedValue({ token: "gh-token" });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function connect(provider: OwnedProvider, m: Record<string, string> = {}) {
  store[provider] = { provider, accessToken: `${provider}-token`, meta: m };
}

const A = { id: "1001", name: "Acme" };
const B = { id: "1002", name: "Beta" };

describe("reading a pick, which sits on every org lookup", () => {
  it.each([
    ["gitlab", listGitlabGroups],
    ["azure", listAzureOrgs],
    ["clickup", listClickUpWorkspaces],
    ["notion", listNotionWorkspaces],
    ["trello", listTrelloWorkspaces],
    ["asana", listAsanaWorkspaces],
    ["monday", listMondayAccount],
  ] as const)("never asks %s: nothing stored means no pick", async (provider, lister) => {
    vi.stubEnv("TRELLO_API_KEY", "app-key");
    connect(provider);
    vi.mocked(lister).mockResolvedValue([A]);

    expect(await getPickedWorkspace(user, provider)).toBeNull();
    expect(lister).not.toHaveBeenCalled();
  });

  it("never asks GitHub: a stored githubOrg or nothing", async () => {
    vi.mocked(listGithubOrgs).mockResolvedValue([{ login: "Acme", name: "Acme" }]);
    expect(await getPickedWorkspace(user, "github")).toBeNull();
    expect(getGithubToken).not.toHaveBeenCalled();
    expect(listGithubOrgs).not.toHaveBeenCalled();
  });

  it("reads the workspace connect stored for a Brief-held tracker", async () => {
    connect("monday", { workspaceId: "77", workspaceName: "Acme" });
    expect(await getPickedWorkspace(user, "monday")).toEqual({ id: "77", name: "Acme" });
    expect(listMondayAccount).not.toHaveBeenCalled();
  });

  it("reads Notion's workspace off the connection, as connect stored it from the token reply", async () => {
    connect("notion", { workspaceId: "ws-uuid", workspaceName: "Acme" });
    expect(await getPickedWorkspace(user, "notion")).toEqual({ id: "ws-uuid", name: "Acme" });
    expect(await workspacesToPick(user, "notion")).toEqual([]);
    expect(listNotionWorkspaces).not.toHaveBeenCalled();
  });

  // getConnection decrypts, and refreshes an expiring token: the org lookup
  // must never cost a token round trip.
  it("reads the pick from the stored meta alone, never the live connection", async () => {
    connect("azure", { workspaceId: "contoso", workspaceName: "Contoso" });
    expect(await getPickedWorkspace(user, "azure")).toEqual({ id: "contoso", name: "Contoso" });
    expect(readConnectionMeta).toHaveBeenCalledWith(user, "azure");
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("reads no pick, rather than throwing, when the store is down", async () => {
    vi.mocked(readConnectionMeta).mockRejectedValue(new Error("db down"));
    expect(await getPickedWorkspace(user, "clickup")).toBeNull();
  });

  it("reads a GitLab pick off the connection, never Clerk", async () => {
    meta = { trackerWorkspace: { gitlab: { id: B.id, name: B.name } } };
    connect("gitlab", { workspaceId: A.id, workspaceName: A.name });
    expect(await getPickedWorkspace(user, "gitlab")).toEqual(A);
    expect(getClerkUser).not.toHaveBeenCalled();
    expect(listGitlabGroups).not.toHaveBeenCalled();
  });
});

describe("Settings with nothing picked", () => {
  it("offers a lone workspace on a click-only tracker rather than leave no org", async () => {
    connect("clickup");
    vi.mocked(listClickUpWorkspaces).mockResolvedValue([A]);
    expect(await workspacesToPick(user, "clickup")).toEqual([A]);

    vi.mocked(listGithubOrgs).mockResolvedValue([{ login: "Acme", name: "Acme" }]);
    expect(await workspacesToPick(user, "github")).toEqual([{ id: "Acme", name: "Acme", avatarUrl: undefined }]);
  });

  it("stores a Monday pick on the connection, where the org lookup reads it", async () => {
    connect("monday");
    vi.mocked(listMondayAccount).mockResolvedValue([{ id: "77", name: "Acme" }]);
    expect(await setPickedWorkspace(user, "monday", "77")).toEqual({ ok: true });
    expect(setConnectionMeta).toHaveBeenCalledWith(user, "monday", { workspaceId: "77", workspaceName: "Acme" });
  });
});

describe("an account that sees several workspaces", () => {
  it("has no pick, and is offered the list, until one is set", async () => {
    connect("gitlab", { label: "Razi" });
    vi.mocked(listGitlabGroups).mockResolvedValue([A, B]);

    expect(await getPickedWorkspace(user, "gitlab")).toBeNull();
    expect(await workspacesToPick(user, "gitlab")).toEqual([A, B]);
    expect(listGitlabGroups).toHaveBeenCalledWith({ token: "gitlab-token" });

    expect(await setPickedWorkspace(user, "gitlab", B.id)).toEqual({ ok: true });
    expect(setConnectionMeta).toHaveBeenCalledWith(user, "gitlab", { workspaceId: B.id, workspaceName: B.name });
    expect(clerk.updateUserMetadata).not.toHaveBeenCalled();
    // What the row now holds is what the next read sees.
    connect("gitlab", { label: "Razi", workspaceId: B.id, workspaceName: B.name });

    expect(await getPickedWorkspace(user, "gitlab")).toEqual(B);
    expect(await workspacesToPick(user, "gitlab")).toEqual([]);
  });

  it("offers nothing once a pick is stored", async () => {
    connect("clickup", { workspaceId: A.id, workspaceName: A.name });
    vi.mocked(listClickUpWorkspaces).mockResolvedValue([A, B]);

    expect(await workspacesToPick(user, "clickup")).toEqual([]);
    expect(await getPickedWorkspace(user, "clickup")).toEqual(A);
    // A stored pick is read off the row, not re-checked with the tracker.
    expect(listClickUpWorkspaces).not.toHaveBeenCalled();
  });

  it("offers nothing to an account that sees none", async () => {
    connect("trello");
    vi.stubEnv("TRELLO_API_KEY", "app-key");
    vi.mocked(listTrelloWorkspaces).mockResolvedValue([]);
    expect(await workspacesToPick(user, "trello")).toEqual([]);
    expect(await getPickedWorkspace(user, "trello")).toBeNull();
  });
});

describe("setPickedWorkspace", () => {
  it("rejects an id the token can't see, and stores nothing", async () => {
    connect("clickup");
    vi.mocked(listClickUpWorkspaces).mockResolvedValue([A, B]);

    const res = await setPickedWorkspace(user, "clickup", "9999");
    expect(res.ok).toBe(false);
    expect(setConnectionMeta).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });

  it("rejects a pick for a tracker that isn't connected", async () => {
    vi.mocked(listClickUpWorkspaces).mockResolvedValue([A]);
    const res = await setPickedWorkspace(user, "clickup", A.id);
    expect(res).toEqual({ ok: false, error: "ClickUp isn't connected." });
    expect(listClickUpWorkspaces).not.toHaveBeenCalled();
  });

  it.each([
    ["gitlab", listGitlabGroups],
    ["clickup", listClickUpWorkspaces],
    ["azure", listAzureOrgs],
    ["notion", listNotionWorkspaces],
    ["asana", listAsanaWorkspaces],
    ["trello", listTrelloWorkspaces],
  ] as const)("stores %s's pick on the connection's account_meta", async (provider, lister) => {
    vi.stubEnv("TRELLO_API_KEY", "app-key");
    connect(provider, { label: "Razi" });
    vi.mocked(lister).mockResolvedValue([A, B]);

    expect(await setPickedWorkspace(user, provider, B.id)).toEqual({ ok: true });
    expect(setConnectionMeta).toHaveBeenCalledWith(user, provider, { workspaceId: B.id, workspaceName: B.name });
    expect(clerk.updateUserMetadata).not.toHaveBeenCalled();
  });

  it("lists each Brief-held tracker with its own token: Azure DevOps as a bearer, Trello beside the app key", async () => {
    vi.stubEnv("TRELLO_API_KEY", "app-key");
    for (const p of ["gitlab", "azure", "notion", "trello"] as const) connect(p);
    vi.mocked(listGitlabGroups).mockResolvedValue([A]);
    vi.mocked(listAzureOrgs).mockResolvedValue([A]);
    vi.mocked(listNotionWorkspaces).mockResolvedValue([A]);
    vi.mocked(listTrelloWorkspaces).mockResolvedValue([A]);

    for (const p of ["gitlab", "azure", "notion", "trello"] as const) await listWorkspaces(user, p);
    expect(listGitlabGroups).toHaveBeenCalledWith({ token: "gitlab-token" });
    expect(listAzureOrgs).toHaveBeenCalledWith("Bearer azure-token");
    expect(listNotionWorkspaces).toHaveBeenCalledWith({ token: "notion-token" });
    expect(listTrelloWorkspaces).toHaveBeenCalledWith({ key: "app-key", token: "trello-token" });
  });

  it.each(["azure", "gitlab"] as const)("won't clear %s's pick, which lives on the connection", async (provider) => {
    connect(provider, { workspaceId: A.id, workspaceName: A.name });
    const res = await setPickedWorkspace(user, provider, "");
    expect(res.ok).toBe(false);
    expect(setConnectionMeta).not.toHaveBeenCalled();
    expect(clerk.updateUserMetadata).not.toHaveBeenCalled();
  });

  it("clears the cached org_members row so the new org shows at once", async () => {
    connect("asana");
    vi.mocked(listAsanaWorkspaces).mockResolvedValue([A, B]);

    await setPickedWorkspace(user, "asana", A.id);
    expect(db.from).toHaveBeenCalledWith("org_members");
    expect(db.del).toHaveBeenCalled();
    expect(db.eq).toHaveBeenCalledWith("user_id", user);
  });

  it("refuses Linear and Jira, whose org comes from the token", async () => {
    expect(hasWorkspacePick("linear")).toBe(false);
    expect(hasWorkspacePick("jira")).toBe(false);
    expect(hasWorkspacePick("nonsense")).toBe(false);
    expect(hasWorkspacePick("gitlab")).toBe(true);
    expect((await setPickedWorkspace(user, "linear", "abc")).ok).toBe(false);
    expect(await listWorkspaces(user, "jira")).toEqual([]);
    expect(await getPickedWorkspace(user, "linear")).toBeNull();
  });
});

describe("GitHub", () => {
  const ORGS = [
    { login: "Acme", name: "Acme", avatarUrl: "https://avatars.test/acme" },
    { login: "beta", name: "beta" },
  ];

  it("reads the githubOrg the picker has always written, without listing", async () => {
    meta = { githubOrg: "Acme" };
    expect(await getPickedWorkspace(user, "github")).toEqual({ id: "Acme", name: "Acme" });
    expect(listGithubOrgs).not.toHaveBeenCalled();
  });

  it("lists orgs by login, and stores the login as GitHub spells it", async () => {
    vi.mocked(listGithubOrgs).mockResolvedValue(ORGS);
    expect(await listWorkspaces(user, "github")).toEqual([
      { id: "Acme", name: "Acme", avatarUrl: "https://avatars.test/acme" },
      { id: "beta", name: "beta", avatarUrl: undefined },
    ]);

    expect(await setPickedWorkspace(user, "github", "acme")).toEqual({ ok: true });
    expect(clerk.updateUserMetadata).toHaveBeenCalledWith(user, { privateMetadata: { githubOrg: "Acme" } });
  });

  it("clears the pick with an empty id", async () => {
    meta = { githubOrg: "Acme" };
    expect(await setPickedWorkspace(user, "github", "  ")).toEqual({ ok: true });
    expect(clerk.updateUserMetadata).toHaveBeenCalledWith(user, { privateMetadata: { githubOrg: "" } });
  });
});

describe("listWorkspaces", () => {
  it("remembers a listing for a few minutes, but proves a pick against a fresh one", async () => {
    connect("clickup");
    vi.mocked(listClickUpWorkspaces).mockResolvedValue([A, B]);

    await listWorkspaces(user, "clickup");
    await listWorkspaces(user, "clickup");
    await workspacesToPick(user, "clickup");
    expect(listClickUpWorkspaces).toHaveBeenCalledTimes(1);

    await setPickedWorkspace(user, "clickup", A.id);
    expect(listClickUpWorkspaces).toHaveBeenCalledTimes(2);
  });

  it("doesn't remember 'not connected', so a fresh connection is seen at once", async () => {
    vi.mocked(listClickUpWorkspaces).mockResolvedValue([A, B]);
    expect(await listWorkspaces(user, "clickup")).toEqual([]);

    connect("clickup");
    // Let the first listing settle so its entry is dropped.
    await new Promise((r) => setTimeout(r, 0));
    expect(await listWorkspaces(user, "clickup")).toEqual([A, B]);
  });

  it("doesn't remember an empty listing, which the listers also return on a failure", async () => {
    connect("clickup");
    vi.mocked(listClickUpWorkspaces).mockResolvedValueOnce([]);
    expect(await listWorkspaces(user, "clickup")).toEqual([]);

    await new Promise((r) => setTimeout(r, 0));
    vi.mocked(listClickUpWorkspaces).mockResolvedValueOnce([A]);
    expect(await listWorkspaces(user, "clickup")).toEqual([A]);
    expect(listClickUpWorkspaces).toHaveBeenCalledTimes(2);
  });

  it("forgets a remembered listing when the user's tracker changes", async () => {
    connect("gitlab");
    vi.mocked(listGitlabGroups).mockResolvedValue([A]);
    await listWorkspaces(user, "gitlab");
    await listWorkspaces(user, "gitlab");
    expect(listGitlabGroups).toHaveBeenCalledTimes(1);

    forgetWorkspaces(user);
    vi.mocked(listGitlabGroups).mockResolvedValue([B]);
    expect(await listWorkspaces(user, "gitlab")).toEqual([B]);
    expect(listGitlabGroups).toHaveBeenCalledTimes(2);
  });

  it("names every tracker's workspace", () => {
    expect(WORKSPACE_NOUN.github).toBe("organization");
    expect(WORKSPACE_NOUN.gitlab).toBe("group");
    expect(WORKSPACE_NOUN.monday).toBe("account");
  });
});
