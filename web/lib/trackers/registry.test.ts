import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Linear, Jira and GitHub fall back to a Clerk token from before their move to
// Brief's OAuth; with no client every such lookup reads as "not connected",
// which is what these tests want unless they say otherwise.
const clerk = vi.hoisted(() => ({ clerkClient: vi.fn<() => Promise<unknown>>(async () => null) }));
vi.mock("@clerk/nextjs/server", () => clerk);

/** A Clerk client that vends `tokens[strategy]` for the user, as getUserOauthAccessToken does. */
function clerkVends(tokens: Record<string, string>) {
  const getUserOauthAccessToken = vi.fn(async (_userId: string, strategy: string) => ({
    data: tokens[strategy] ? [{ token: tokens[strategy] }] : [],
  }));
  clerk.clerkClient.mockResolvedValue({ users: { getUserOauthAccessToken } });
  return getUserOauthAccessToken;
}

// The Clerk user (connected accounts) and the owned connection store are the
// two sources of "connected"; both are stood in for here.
vi.mock("@/lib/clerk-user", () => ({ getClerkUser: vi.fn() }));
vi.mock("@/lib/connections", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/connections")>();
  return {
    ...mod,
    getConnection: vi.fn(),
    readConnection: vi.fn(),
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
  readConnection,
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
/** Rows the store holds but can't use: a refused refresh, a key that won't decrypt. */
let broken = new Set<OwnedProvider>();

function conn(provider: OwnedProvider, meta: Record<string, string> = {}): Connection {
  return { provider, accessToken: `${provider}-token`, meta };
}

beforeEach(() => {
  store = {};
  clerk.clerkClient.mockReset();
  clerk.clerkClient.mockImplementation(async () => null);
  vi.mocked(getConnection).mockReset();
  vi.mocked(getConnection).mockImplementation(async (_userId, provider) => store[provider] ?? null);
  broken = new Set();
  vi.mocked(readConnection).mockReset();
  vi.mocked(readConnection).mockImplementation(async (_userId, provider) => {
    if (broken.has(provider)) return { state: "unusable" };
    const c = store[provider];
    return c ? { state: "connected", connection: c } : { state: "absent" };
  });
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

  it("gives Linear, Jira and GitHub a Clerk strategy and match string for accounts from before the move, and no other tracker one", () => {
    for (const def of PROVIDERS) {
      if (["linear", "jira", "github"].includes(def.key)) {
        expect(def.clerkStrategy, def.key).toBeTruthy();
        expect(def.clerkMatch, def.key).toBeTruthy();
      } else {
        expect(def.clerkStrategy, def.key).toBeUndefined();
        expect(def.clerkMatch, def.key).toBeUndefined();
      }
    }
    expect(CLERK_PROVIDERS.map((p) => p.key)).toEqual(["linear", "jira", "github"]);
  });

  it("keeps every tracker in Brief's connection store, in the same order", () => {
    // The registry and the store must agree, or a connection could be stored
    // for a tracker the registry never resolves.
    expect(PROVIDERS.map((p) => p.key)).toEqual(OWNED_PROVIDERS);
  });

  it("only waits on a workspace pick where filing can't happen without one", () => {
    // Jira waits on its site too, but only when Brief holds it: its own check decides.
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

  it("tries every tracker with a Clerk account when Clerk can't say which are connected", async () => {
    vi.mocked(getClerkUser).mockRejectedValue(new Error("clerk down"));
    store.monday = conn("monday");
    expect((await resolveTracker("user_1"))?.kind).toBe("monday");
    // Linear, Jira and GitHub were tried, Brief's store first and then Clerk,
    // before Monday won.
    expect(clerk.clerkClient).toHaveBeenCalled();
    expect(vi.mocked(readConnection).mock.calls.map(([, p]) => p)).toEqual(["linear", "jira", "github"]);
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

describe("Linear, Jira and GitHub during the move off Clerk", () => {
  /** The first request a tracker makes, with fetch failing so nothing goes further. */
  async function firstRequest(t: Tracker): Promise<{ url: string; auth: string | null }> {
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    await t.listTargets().catch(() => {});
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    return { url: String(url), auth: new Headers(init?.headers).get("authorization") };
  }

  it.each([
    ["linear", "api.linear.app/graphql"],
    ["github", "api.github.com"],
  ] as const)("files into %s from a connection Brief holds, without asking Clerk", async (key, host) => {
    store[key] = conn(key);
    const t = await resolveTracker("user_1", key);
    expect(t?.kind).toBe(key);
    expect(clerk.clerkClient).not.toHaveBeenCalled();
    const req = await firstRequest(t!);
    expect(req.url).toContain(host);
    expect(req.auth).toBe(`Bearer ${key}-token`);
  });

  it.each([
    ["linear", "oauth_linear", "api.linear.app/graphql"],
    ["github", "oauth_github", "api.github.com"],
  ] as const)("keeps filing into %s on the Clerk token from before the move", async (key, strategy, host) => {
    const vend = clerkVends({ [strategy]: `clerk-${key}` });
    vi.mocked(getClerkUser).mockResolvedValue({ externalAccounts: [{ provider: strategy }] } as never);

    const t = await resolveTracker("user_1");
    expect(t?.kind).toBe(key);
    // Brief's store was asked first, and held nothing.
    expect(readConnection).toHaveBeenCalledWith("user_1", key);
    expect(vend).toHaveBeenCalledWith("user_1", strategy);
    const req = await firstRequest(t!);
    expect(req.url).toContain(host);
    expect(req.auth).toBe(`Bearer clerk-${key}`);
  });

  it("prefers a connection Brief holds over a Clerk account for the same tracker", async () => {
    const vend = clerkVends({ oauth_linear: "clerk-linear" });
    vi.mocked(getClerkUser).mockResolvedValue({ externalAccounts: [{ provider: "oauth_linear" }] } as never);
    store.linear = conn("linear");

    const t = await resolveTracker("user_1");
    expect((await firstRequest(t!)).auth).toBe("Bearer linear-token");
    expect(vend).not.toHaveBeenCalled();
  });

  it("files a Brief-held Jira into the picked site, through Atlassian's gateway", async () => {
    store.jira = conn("jira", { workspaceId: "cloud-2", workspaceName: "beta", siteUrl: "https://beta.atlassian.net" });
    const t = await resolveTracker("user_1", "jira");
    expect(t?.kind).toBe("jira");
    const req = await firstRequest(t!);
    expect(req.url).toContain("https://api.atlassian.com/ex/jira/cloud-2/rest/api/3/");
    expect(req.auth).toBe("Bearer jira-token");
    expect(clerk.clerkClient).not.toHaveBeenCalled();
  });

  it("asks for the Jira site of a Brief-held connection rather than a reconnect", async () => {
    store.jira = conn("jira");
    expect(await checkTracker("user_1", "jira")).toEqual({ tracker: null, problem: "needsWorkspace" });
    expect((await trackerStatus("user_1")).issue).toBe("Pick your Jira site under Settings, then retry.");
    expect(await checkTrackerHealth("user_1", ["jira"])).toEqual({
      stale: [],
      needsWorkspace: ["jira"],
      unavailable: [],
    });
    // The Clerk account a Brief connect replaced is not looked for.
    expect(clerk.clerkClient).not.toHaveBeenCalled();
  });

  it("keeps a Clerk-held Jira on its token's first site, as before the move", async () => {
    clerkVends({ oauth_atlassian: "clerk-jira" });
    vi.mocked(getClerkUser).mockResolvedValue({ externalAccounts: [{ provider: "oauth_atlassian" }] } as never);
    const fetchMock = vi.fn(async () =>
      Response.json([
        { id: "cloud-1", url: "https://acme.atlassian.net", name: "acme" },
        { id: "cloud-2", url: "https://beta.atlassian.net", name: "beta" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const t = await resolveTracker("user_1");
    expect(t?.kind).toBe("jira");
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain("accessible-resources");
    expect((await firstRequest(t!)).url).toContain("/ex/jira/cloud-1/");
  });

  it("keeps the JIRA_API_TOKEN test account working when nothing else holds Jira", async () => {
    vi.stubEnv("JIRA_API_TOKEN", "api-token");
    vi.stubEnv("JIRA_EMAIL", "qa@example.com");
    vi.stubEnv("JIRA_SITE", "https://qa.atlassian.net/");
    const t = await resolveTracker("user_1", "jira");
    expect(t?.kind).toBe("jira");
    const req = await firstRequest(t!);
    expect(req.url).toContain("https://qa.atlassian.net/rest/api/3/");
    expect(req.auth).toBe(`Basic ${Buffer.from("qa@example.com:api-token").toString("base64")}`);
  });

  it("calls a Brief-held connection whose token is gone stale, even with Clerk down", async () => {
    vi.mocked(getClerkUser).mockRejectedValue(new Error("clerk down"));
    // The row lists, but its refresh was refused; there is no Clerk token either.
    vi.mocked(listConnectedProviders).mockResolvedValue(["linear"]);
    expect((await trackerStatus("user_1")).issue).toBe(
      "Your Linear connection has expired - reconnect it under Settings, then retry.",
    );
  });

  it("never calls one of the three unavailable, since a Clerk connect is still offered without Brief's app", async () => {
    vi.mocked(isProviderConfigured).mockReturnValue(false);
    vi.mocked(listConnectedProviders).mockResolvedValue(["github"]);
    expect(await checkTracker("user_1", "github")).toEqual({ tracker: null, problem: "stale" });
  });
});

describe("a Brief row decides, even when it can't be used", () => {
  it.each([
    ["linear", "oauth_linear"],
    ["github", "oauth_github"],
    ["jira", "oauth_atlassian"],
  ] as const)("calls %s stale rather than fall back to a Clerk token when its Brief row can't be used", async (key, strategy) => {
    const vend = clerkVends({ [strategy]: `clerk-${key}` });
    vi.mocked(getClerkUser).mockResolvedValue({ externalAccounts: [{ provider: strategy }] } as never);
    vi.mocked(listConnectedProviders).mockResolvedValue([key]);
    broken.add(key);

    expect(await checkTracker("user_1", key)).toEqual({ tracker: null, problem: "stale" });
    expect(await resolveTracker("user_1")).toBeNull();
    expect((await trackerStatus("user_1")).issue).toContain("connection has expired");
    expect(vend).not.toHaveBeenCalled();
  });

  it("never files a Jira whose Brief row can't be used through the JIRA_API_TOKEN test account", async () => {
    vi.stubEnv("JIRA_API_TOKEN", "api-token");
    vi.stubEnv("JIRA_EMAIL", "qa@example.com");
    vi.stubEnv("JIRA_SITE", "https://qa.atlassian.net/");
    broken.add("jira");
    expect(await checkTracker("user_1", "jira")).toEqual({ tracker: null, problem: "stale" });
  });
});

describe("connectedTrackers", () => {
  it("counts a tracker connected through Brief, through Clerk, or both, once", async () => {
    vi.mocked(getClerkUser).mockResolvedValue({
      externalAccounts: [{ provider: "oauth_linear" }, { provider: "oauth_github" }],
    } as never);
    store.linear = conn("linear");
    store.jira = conn("jira");
    expect(await connectedTrackers("user_1")).toEqual(["linear", "jira", "github"]);
  });

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
