import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Clerk-backed adapters reach for Clerk to vend a token; with no client
// every one of them reads as "not connected", which is what these tests want
// unless they say otherwise.
const clerk = vi.hoisted(() => ({ clerkClient: vi.fn(async () => null) }));
vi.mock("@clerk/nextjs/server", () => clerk);

// The Clerk user (connected accounts) and the owned connection store are the
// two sources of "connected"; both are stood in for here.
vi.mock("@/lib/clerk-user", () => ({ getClerkUser: vi.fn() }));
vi.mock("@/lib/connections", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/connections")>();
  return {
    ...mod,
    getConnection: vi.fn(),
    listConnectedProviders: vi.fn(),
    isProviderConfigured: vi.fn(),
  };
});

import {
  CLERK_PROVIDERS,
  NO_TRACKER_ERROR,
  PROVIDERS,
  checkTracker,
  connectedProviders,
  connectedTrackers,
  providerDef,
  providerName,
  resolveTracker,
  resolveTrackerOrError,
  trackerStatus,
} from "@/lib/trackers/registry";
import { checkTrackerHealth } from "@/lib/tracker-health";
import { PROVIDER_KEYS } from "@/lib/ticket-sync";
import { PROVIDER_LABELS } from "@/lib/provider-labels";
import { getClerkUser } from "@/lib/clerk-user";
import {
  OWNED_PROVIDERS,
  getConnection,
  isProviderConfigured,
  listConnectedProviders,
  type Connection,
  type OwnedProvider,
} from "@/lib/connections";
import { makeGithubTracker } from "@/lib/github";
import { makeLinearTracker } from "@/lib/linear";
import { makeJiraTracker } from "@/lib/jira";
import { makeGitlabTracker } from "@/lib/gitlab";
import { makeAzureTracker } from "@/lib/azure";
import { makeClickUpTracker } from "@/lib/clickup";
import { makeNotionTracker } from "@/lib/notion";
import { makeTrelloTracker } from "@/lib/trello";
import { makeAsanaTracker } from "@/lib/asana";
import { makeMondayTracker } from "@/lib/monday";
import type { Tracker } from "@/lib/tracker";

/** The owned connections the store holds for the test user. */
let store: Partial<Record<OwnedProvider, Connection>> = {};

function conn(provider: OwnedProvider, meta: Record<string, string> = {}): Connection {
  return { provider, accessToken: `${provider}-token`, meta };
}

beforeEach(() => {
  store = {};
  clerk.clerkClient.mockClear();
  vi.mocked(getConnection).mockReset();
  vi.mocked(getConnection).mockImplementation(async (_userId, provider) => store[provider] ?? null);
  vi.mocked(listConnectedProviders).mockReset();
  vi.mocked(listConnectedProviders).mockImplementation(async () => Object.keys(store) as OwnedProvider[]);
  vi.mocked(getClerkUser).mockReset();
  vi.mocked(getClerkUser).mockResolvedValue({ externalAccounts: [] } as never);
  vi.mocked(isProviderConfigured).mockReset();
  vi.mocked(isProviderConfigured).mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the registry covers every provider exactly once", () => {
  it("registers every ProviderKey", () => {
    expect(PROVIDERS.map((p) => p.key).sort()).toEqual([...PROVIDER_KEYS].sort());
  });

  it("registers no provider twice", () => {
    const keys = PROVIDERS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps Linear and Jira first, so existing users' resolution order is unchanged", () => {
    expect(PROVIDERS.slice(0, 2).map((p) => p.key)).toEqual(["linear", "jira"]);
  });

  it("orders every provider for the one-tracker tie-break", () => {
    expect(PROVIDERS.map((p) => p.key)).toEqual([
      "linear",
      "jira",
      "github",
      "gitlab",
      "azure",
      "clickup",
      "notion",
      "trello",
      "asana",
      "monday",
    ]);
  });

  it("gives every Clerk-backed provider a strategy and a match string, and owned ones neither", () => {
    for (const def of PROVIDERS) {
      if (def.auth === "clerk") {
        expect(def.clerkStrategy, def.key).toBeTruthy();
        expect(def.clerkMatch, def.key).toBeTruthy();
      } else {
        expect(def.clerkStrategy, def.key).toBeUndefined();
        expect(def.clerkMatch, def.key).toBeUndefined();
      }
    }
  });

  it("splits providers between Clerk and the owned store with nothing in both", () => {
    expect(CLERK_PROVIDERS.map((p) => p.key)).toEqual(["linear", "jira", "github"]);
    // The owned defs and the connection store must agree, or a connection
    // could be stored for a tracker the registry never resolves.
    const owned = PROVIDERS.filter((p) => p.auth === "owned").map((p) => p.key);
    expect(owned.sort()).toEqual([...OWNED_PROVIDERS].sort());
  });

  it("only waits on a workspace pick where filing can't happen without one", () => {
    expect(PROVIDERS.filter((p) => p.requiresWorkspace).map((p) => p.key)).toEqual(["azure", "asana"]);
  });

  it("names every provider the same way the client components do", () => {
    for (const key of PROVIDER_KEYS) {
      expect(providerName(key)).not.toBe(key);
      expect(providerName(key)).toBe(PROVIDER_LABELS[key]);
    }
    expect(providerDef("github")?.name).toBe("GitHub");
  });
});

// Every adapter is built with a throwaway token: none of these calls touch the
// network, they only assert the shape the rest of the app relies on.
const ADAPTERS: Array<[string, () => Tracker]> = [
  ["linear", () => makeLinearTracker({ token: "t" })],
  ["jira", () => makeJiraTracker({ token: "t", kind: "oauth" }, { cloudId: "c", siteUrl: "https://x" })],
  ["github", () => makeGithubTracker({ token: "t" })],
  ["gitlab", () => makeGitlabTracker({ token: "t" })],
  ["azure", () => makeAzureTracker({ org: "o", authorization: "Bearer t" })],
  ["clickup", () => makeClickUpTracker({ token: "t" })],
  ["notion", () => makeNotionTracker({ token: "t" })],
  ["trello", () => makeTrelloTracker({ key: "k", token: "t" })],
  ["asana", () => makeAsanaTracker({ token: "t", workspaceGid: "1" })],
  ["monday", () => makeMondayTracker({ token: "t" })],
];

describe("every adapter satisfies the Tracker contract", () => {
  it("covers every registered provider", () => {
    expect(ADAPTERS.map(([key]) => key)).toEqual(PROVIDERS.map((p) => p.key));
  });

  it.each(ADAPTERS)("%s", (key, build) => {
    const t = build();
    expect(t.kind).toBe(key);
    // The noun is shown to the model as the word for a filing destination, so
    // it has to be real - "team", "repository", not a placeholder.
    expect(t.targetNoun).toMatch(/^[a-z ]+$/);
    for (const method of [
      "listTargets",
      "searchIssues",
      "getTargetDetails",
      "fileIssue",
      "updateIssue",
      "getIssue",
      "getLiveIssues",
    ] as const) {
      expect(typeof t[method], `${key}.${method}`).toBe("function");
    }
  });

  it.each(ADAPTERS)("%s declares complete capabilities", (_key, build) => {
    const caps = build().capabilities;
    for (const flag of [
      "projects",
      "states",
      "priority",
      "labels",
      "customFields",
      "issueTypes",
      "comments",
      "nativeAttachments",
    ] as const) {
      expect(typeof caps[flag]).toBe("boolean");
    }
  });

  it("marks GitHub as a tracker with no upload API", () => {
    // GitHub has no public image-upload API, which is why briefs keep their
    // screenshots after filing and the evidence route exists at all.
    const byUrl = ADAPTERS.filter(([, build]) => !build().capabilities.nativeAttachments).map(
      ([key]) => key,
    );
    expect(byUrl).toContain("github");
    expect(byUrl).not.toContain("linear");
    expect(byUrl).not.toContain("jira");
  });

  it("gives every tracker newer than Linear and Jira a body guidance line", () => {
    // Linear and Jira predate this and take markdown through their own
    // converters; every adapter since explains its own body format to the agent.
    const unguided = ADAPTERS.filter(([, build]) => !build().bodyGuidance).map(([key]) => key);
    expect(unguided).toEqual(["linear", "jira"]);
  });
});

describe("resolveTracker", () => {
  it("returns null when nothing is connected", async () => {
    // No Clerk client and an empty store: every resolve degrades to null.
    await expect(resolveTracker("user_1")).resolves.toBeNull();
  });

  it("returns null for a pinned provider that isn't connected, rather than another one", async () => {
    // A brief filed to Jira must never be re-filed somewhere else.
    store.monday = conn("monday");
    await expect(resolveTracker("user_1", "jira")).resolves.toBeNull();
  });

  it("resolves an owned provider from its stored connection", async () => {
    store.monday = conn("monday");
    const t = await resolveTracker("user_1");
    expect(t?.kind).toBe("monday");
    expect(getConnection).toHaveBeenCalledWith("user_1", "monday");
  });

  it("files into the first connected provider in registry order", async () => {
    store.monday = conn("monday");
    store.clickup = conn("clickup");
    expect((await resolveTracker("user_1"))?.kind).toBe("clickup");
  });

  it("only tries what is connected: a Monday-only user costs no Clerk token call", async () => {
    store.monday = conn("monday");
    expect((await resolveTracker("user_1"))?.kind).toBe("monday");
    expect((await trackerStatus("user_1")).tracker).toBe("monday");
    // Not one Clerk token lookup, and no other owned connection read.
    expect(clerk.clerkClient).not.toHaveBeenCalled();
    expect(new Set(vi.mocked(getConnection).mock.calls.map(([, p]) => p))).toEqual(new Set(["monday"]));
  });

  it("tries every Clerk-backed tracker when Clerk can't say which are connected", async () => {
    vi.mocked(getClerkUser).mockRejectedValue(new Error("clerk down"));
    store.monday = conn("monday");
    expect((await resolveTracker("user_1"))?.kind).toBe("monday");
    // The Clerk-backed adapters were asked for a token before Monday won.
    expect(clerk.clerkClient).toHaveBeenCalled();
    expect(vi.mocked(getConnection).mock.calls.map(([, p]) => p)).toEqual(["monday"]);
  });

  it("only tries the pinned provider", async () => {
    vi.stubEnv("TRELLO_API_KEY", "app-key");
    store.trello = conn("trello");
    store.azure = conn("azure", { workspaceId: "acme" });
    expect((await resolveTracker("user_1", "trello"))?.kind).toBe("trello");
    // Not one Clerk token lookup, and no other owned connection read.
    expect(clerk.clerkClient).not.toHaveBeenCalled();
    expect(vi.mocked(getConnection).mock.calls.map(([, p]) => p)).toEqual(["trello"]);
  });

  it("files into Azure DevOps against the picked organization, with a bearer token", async () => {
    store.azure = conn("azure", { workspaceId: "acme", workspaceName: "Acme" });
    const t = await resolveTracker("user_1", "azure");
    expect(t?.kind).toBe("azure");

    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    await t!.listTargets().catch(() => {});
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("dev.azure.com/acme");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer azure-token");
  });

  it("does not resolve Azure DevOps before an organization is picked", async () => {
    store.azure = conn("azure");
    await expect(resolveTracker("user_1", "azure")).resolves.toBeNull();
  });

  it("files into Asana inside the picked workspace", async () => {
    store.asana = conn("asana", { workspaceId: "120001" });
    const t = await resolveTracker("user_1", "asana");
    expect(t?.kind).toBe("asana");

    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    await t!.listTargets().catch(() => {});
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(String(url)).toContain("workspace=120001");
  });

  it("does not resolve Asana before a workspace is picked", async () => {
    store.asana = conn("asana");
    await expect(resolveTracker("user_1", "asana")).resolves.toBeNull();
  });

  it.each([
    ["gitlab", "gitlab.com/api/v4/"],
    ["notion", "api.notion.com/v1/"],
  ] as const)("files into %s from its stored connection, with a bearer token and no pick", async (key, host) => {
    store[key] = conn(key);
    const t = await resolveTracker("user_1", key);
    expect(t?.kind).toBe(key);
    // Not one Clerk token lookup: the token is Brief's own.
    expect(clerk.clerkClient).not.toHaveBeenCalled();

    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    await t!.listTargets().catch(() => {});
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain(host);
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${key}-token`);
  });

  it("resolves ClickUp with or without a workspace pick", async () => {
    store.clickup = conn("clickup");
    expect((await resolveTracker("user_1", "clickup"))?.kind).toBe("clickup");
    store.clickup = conn("clickup", { workspaceId: "9001" });
    expect((await resolveTracker("user_1", "clickup"))?.kind).toBe("clickup");
  });

  it("sends Trello the app's API key next to the user's token", async () => {
    vi.stubEnv("TRELLO_API_KEY", "app-key");
    store.trello = conn("trello");
    const t = await resolveTracker("user_1", "trello");
    expect(t?.kind).toBe("trello");

    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    await t!.listTargets().catch(() => {});
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(String(url)).toContain("key=app-key");
    expect(String(url)).toContain("token=trello-token");
  });

  it("does not resolve Trello on a deployment without the API key", async () => {
    vi.stubEnv("TRELLO_API_KEY", "");
    vi.mocked(isProviderConfigured).mockImplementation((p) => p !== "trello");
    store.trello = conn("trello");
    await expect(resolveTracker("user_1", "trello")).resolves.toBeNull();
    expect(await checkTracker("user_1", "trello")).toEqual({ tracker: null, problem: "unavailable" });
  });
});

describe("connectedTrackers", () => {
  it("merges Clerk accounts and owned connections, in registry order", async () => {
    vi.mocked(getClerkUser).mockResolvedValue({
      externalAccounts: [
        { provider: "oauth_atlassian" },
        { provider: "oauth_github", verification: { status: "verified" } },
        // An abandoned OAuth attempt doesn't count.
        { provider: "oauth_linear", verification: { status: "unverified" } },
      ],
    } as never);
    store.monday = conn("monday");
    store.notion = conn("notion");
    store.azure = conn("azure");
    store.gitlab = conn("gitlab");
    expect(await connectedTrackers("user_1")).toEqual(["jira", "github", "gitlab", "azure", "notion", "monday"]);
  });

  it("uses the Clerk user it is handed instead of fetching it again", async () => {
    store.trello = conn("trello");
    const user = { externalAccounts: [{ provider: "oauth_linear" }] };
    expect(await connectedTrackers("user_1", user)).toEqual(["linear", "trello"]);
    expect(getClerkUser).not.toHaveBeenCalled();
  });

  it("reads GitLab and Notion from the connection store, never off the Clerk user", async () => {
    // A Clerk account left from when Clerk held these two counts for nothing.
    const user = { externalAccounts: [{ provider: "gitlab" }, { provider: "notion" }] };
    expect(await connectedTrackers("user_1", user)).toEqual([]);
    store.notion = conn("notion");
    expect(await connectedTrackers("user_1", user)).toEqual(["notion"]);
  });

  it("counts only owned connections when handed no Clerk user", async () => {
    store.asana = conn("asana");
    expect(await connectedTrackers("user_1", null)).toEqual(["asana"]);
  });

  it("leaves a Clerk failure to the caller", async () => {
    vi.mocked(getClerkUser).mockRejectedValue(new Error("clerk down"));
    await expect(connectedTrackers("user_1")).rejects.toThrow("clerk down");
  });

  it("never reads an owned tracker off the Clerk user", () => {
    // Owned trackers have no Clerk match string; an empty one would match
    // every account.
    expect(connectedProviders({ externalAccounts: [{ provider: "oauth_custom_asana" }] })).toEqual([]);
  });
});

describe("checkTracker", () => {
  it("waits on a pick when the connection exists and no workspace is chosen", async () => {
    store.azure = conn("azure");
    store.asana = conn("asana");
    expect(await checkTracker("user_1", "azure")).toEqual({ tracker: null, problem: "needsWorkspace" });
    expect(await checkTracker("user_1", "asana")).toEqual({ tracker: null, problem: "needsWorkspace" });
  });

  it("resolves once a workspace is picked", async () => {
    store.azure = conn("azure", { workspaceId: "acme" });
    expect((await checkTracker("user_1", "azure"))?.tracker?.kind).toBe("azure");
  });

  it("calls a listed connection with no readable token stale", async () => {
    expect(await checkTracker("user_1", "asana")).toEqual({ tracker: null, problem: "stale" });
    expect(await checkTracker("user_1", "linear")).toEqual({ tracker: null, problem: "stale" });
  });

  it("calls a tracker this deployment has no credentials for unavailable, not stale", async () => {
    vi.mocked(isProviderConfigured).mockReturnValue(false);
    expect(await checkTracker("user_1", "monday")).toEqual({ tracker: null, problem: "unavailable" });
  });

  it("never waits on a tracker that files without a pick", async () => {
    store.clickup = conn("clickup");
    expect((await checkTracker("user_1", "clickup"))?.tracker?.kind).toBe("clickup");
  });

  it("reads the connection once per check", async () => {
    // A second read could refresh a revoked grant a second time.
    store.azure = conn("azure");
    await checkTracker("user_1", "azure");
    expect(getConnection).toHaveBeenCalledTimes(1);
  });
});

describe("why there is no tracker", () => {
  it("says nothing is connected when nothing is", async () => {
    expect(NO_TRACKER_ERROR).toBe("No tracker connected - connect one in Settings, then retry.");
    expect(await trackerStatus("user_1")).toEqual({ tracker: null, issue: null });
    expect(await resolveTrackerOrError("user_1")).toEqual({ tracker: null, error: NO_TRACKER_ERROR });
  });

  it("names the tracker that files", async () => {
    store.monday = conn("monday");
    expect(await trackerStatus("user_1")).toEqual({ tracker: "monday", issue: null });
  });

  it("asks for the Azure DevOps organization rather than a reconnect", async () => {
    store.azure = conn("azure");
    const line = "Pick your Azure DevOps organization under Settings, then retry.";
    expect(await trackerStatus("user_1")).toEqual({ tracker: null, issue: line });
    expect((await resolveTrackerOrError("user_1")).error).toBe(line);
  });

  it("asks for the Asana workspace rather than a reconnect", async () => {
    store.asana = conn("asana");
    expect((await trackerStatus("user_1")).issue).toBe("Pick your Asana workspace under Settings, then retry.");
  });

  it("says an owned connection expired when its row is there but no token comes back", async () => {
    // The row lists as connected, but the refresh was refused.
    vi.mocked(listConnectedProviders).mockResolvedValue(["monday"]);
    expect((await trackerStatus("user_1")).issue).toBe(
      "Your Monday connection has expired - reconnect it under Settings, then retry.",
    );
  });

  it("says a Clerk-backed connection expired when Clerk won't vend its token", async () => {
    vi.mocked(getClerkUser).mockResolvedValue({ externalAccounts: [{ provider: "oauth_github" }] } as never);
    expect((await trackerStatus("user_1")).issue).toBe(
      "Your GitHub connection has expired - reconnect it under Settings, then retry.",
    );
  });

  it("says a tracker is unavailable rather than expired when this deployment can't reach it", async () => {
    vi.stubEnv("TRELLO_API_KEY", "");
    vi.mocked(isProviderConfigured).mockImplementation((p) => p !== "trello");
    store.trello = conn("trello");
    expect((await trackerStatus("user_1")).issue).toBe("Trello isn't available right now.");
  });

  it("puts a reconnect the user can do ahead of a tracker they can't fix", async () => {
    vi.mocked(isProviderConfigured).mockImplementation((p) => p !== "trello");
    vi.mocked(listConnectedProviders).mockResolvedValue(["trello", "monday"]);
    expect((await trackerStatus("user_1")).issue).toBe(
      "Your Monday connection has expired - reconnect it under Settings, then retry.",
    );
  });

  it("blames no Clerk-backed tracker when Clerk can't be read", async () => {
    vi.mocked(getClerkUser).mockRejectedValue(new Error("clerk down"));
    expect(await trackerStatus("user_1")).toEqual({ tracker: null, issue: null });
  });

  it("still explains an owned connection when Clerk is down", async () => {
    vi.mocked(getClerkUser).mockRejectedValue(new Error("clerk down"));
    store.azure = conn("azure");
    expect((await trackerStatus("user_1")).issue).toBe(
      "Pick your Azure DevOps organization under Settings, then retry.",
    );
  });

  it("explains a pinned tracker by its own state", async () => {
    store.azure = conn("azure");
    expect(await resolveTrackerOrError("user_1", "azure")).toEqual({
      tracker: null,
      error: "Pick your Azure DevOps organization under Settings, then retry.",
    });
    expect(await resolveTrackerOrError("user_1", "jira")).toEqual({
      tracker: null,
      error: "Jira is not connected - reconnect it under Settings, then retry.",
    });
    vi.mocked(isProviderConfigured).mockReturnValue(false);
    expect((await resolveTrackerOrError("user_1", "monday")).error).toBe("Monday isn't available right now.");
  });
});

describe("tracker health against the real registry", () => {
  it("tells a connection waiting on its workspace from a stale one", async () => {
    // Azure is connected with no organization picked; the Asana row lists but
    // its token can't be read.
    store.azure = conn("azure");
    expect(await checkTrackerHealth("user_1", ["azure", "asana"])).toEqual({
      stale: ["asana"],
      needsWorkspace: ["azure"],
      unavailable: [],
    });
  });

  it("reports a tracker this deployment can't reach as unavailable", async () => {
    vi.stubEnv("TRELLO_API_KEY", "");
    vi.mocked(isProviderConfigured).mockImplementation((p) => p !== "trello");
    store.trello = conn("trello");
    expect(await checkTrackerHealth("user_1", ["trello"])).toEqual({
      stale: [],
      needsWorkspace: [],
      unavailable: ["trello"],
    });
  });

  it("reports nothing once the workspace is picked, reading each connection once", async () => {
    store.azure = conn("azure", { workspaceId: "acme" });
    expect(await checkTrackerHealth("user_1", ["azure"])).toEqual({
      stale: [],
      needsWorkspace: [],
      unavailable: [],
    });
    expect(getConnection).toHaveBeenCalledTimes(1);
  });
});
