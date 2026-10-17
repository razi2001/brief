// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProviderKey } from "./provider-labels";

// The hook talks to Clerk for the Clerk-held trackers; stand in a user whose
// external accounts each test sets.
type FakeAccount = {
  provider: string;
  verification: { status: string };
  destroy: ReturnType<typeof vi.fn>;
};
const clerk = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    externalAccounts: FakeAccount[];
    reload: ReturnType<typeof vi.fn>;
    createExternalAccount: ReturnType<typeof vi.fn>;
  },
}));
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ isLoaded: true, user: clerk.user }),
  useReverification: <A extends unknown[], R>(fn: (...a: A) => R) => fn,
}));

import Integrations from "./Integrations";

type Owned = { provider: ProviderKey; label: string | null; workspace: { id: string; name: string } | null };

let owned: Owned[];
let configured: Record<string, boolean>;
/** What /api/me/connections says about the last failed connect. */
let lastError: { provider: ProviderKey; message: string; detail?: string } | null;
let health: { stale: ProviderKey[]; needsWorkspace: ProviderKey[] };
let fetchMock: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;
let sentTo: string[];
let calls: string[];

/**
 * jsdom's location can't be spied on (its methods are non-configurable), but
 * the global itself can be swapped: reads go to the real one, which
 * history.replaceState keeps current, and navigations are recorded instead.
 */
function stubLocation() {
  const real = window.location;
  vi.stubGlobal("location", {
    get href() {
      return real.href;
    },
    set href(v: string) {
      sentTo.push(v);
    },
    get origin() {
      return real.origin;
    },
    get pathname() {
      return real.pathname;
    },
    get search() {
      return real.search;
    },
    get hash() {
      return real.hash;
    },
    assign,
  });
}

function account(provider: string): FakeAccount {
  return { provider, verification: { status: "verified" }, destroy: vi.fn(async () => {}) };
}

function ownedRow(provider: ProviderKey): Owned {
  return { provider, label: "Razi", workspace: { id: "w1", name: "Acme" } };
}

const json = (body: unknown, ok = true) => ({ ok, json: async () => body });

/** The routes the hook and the card call, over this test's state. */
async function server(url: string, init?: RequestInit) {
  calls.push(`${init?.method ?? "GET"} ${url}`);
  if (url === "/api/me/connections") return json({ owned, configured, lastError });
  if (url === "/api/trackers/health") return json(health);
  const m = url.match(/^\/api\/connect\/(\w+)\/disconnect(\?clerk=keep)?$/);
  if (m && init?.method === "POST") {
    owned = owned.filter((o) => o.provider !== m[1]);
    return json({ ok: true });
  }
  return json({ error: "not found" }, false);
}

beforeEach(() => {
  owned = [];
  lastError = null;
  // Linear, Jira and GitHub default to a deployment without Brief's apps for
  // them, where they connect through Clerk.
  configured = {
    linear: false,
    jira: false,
    github: false,
    gitlab: true,
    azure: true,
    clickup: true,
    notion: true,
    trello: true,
    asana: true,
    monday: true,
  };
  health = { stale: [], needsWorkspace: [] };
  calls = [];
  clerk.user = {
    id: "user_1",
    externalAccounts: [],
    reload: vi.fn(async () => {}),
    createExternalAccount: vi.fn(async () => {
      calls.push("createExternalAccount");
      return { verification: { externalVerificationRedirectURL: new URL("https://github.com/login/oauth") } };
    }),
  };
  fetchMock = vi.fn(server);
  vi.stubGlobal("fetch", fetchMock);
  assign = vi.fn();
  sentTo = [];
  window.history.replaceState(null, "", "/connections");
  stubLocation();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const trigger = () => screen.findByRole("button", { expanded: false });

async function pick(name: string) {
  fireEvent.click(await trigger());
  fireEvent.click(screen.getByRole("option", { name: new RegExp(name) }));
}

const disconnectCalls = () => calls.filter((c) => c.includes("/disconnect"));

describe("Integrations", () => {
  it("offers all ten trackers, in the registry's order", async () => {
    render(<Integrations />);
    fireEvent.click(await trigger());
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names).toEqual([
      "Linear",
      "Jira",
      "GitHub",
      "GitLab",
      "Azure DevOps",
      "ClickUp",
      "Notion",
      "Trello",
      "Asana",
      "Monday",
    ]);
  });

  it("shows a tracker Brief connected itself as the connected one", async () => {
    owned = [ownedRow("asana")];
    render(<Integrations />);
    expect((await trigger()).textContent).toContain("Asana");
    expect(screen.getByText("Connected ✓")).toBeTruthy();
  });

  it("sends an owned connect to the start route and disconnects nothing first", async () => {
    const linear = account("oauth_linear");
    clerk.user!.externalAccounts = [linear];
    render(<Integrations />);
    await pick("Asana");
    fireEvent.click(screen.getByRole("button", { name: "Switch to Asana →" }));

    expect(assign).toHaveBeenCalledWith("/api/connect/asana/start?returnTo=%2Fconnections");
    expect(linear.destroy).not.toHaveBeenCalled();
    expect(disconnectCalls()).toEqual([]);
  });

  it.each(["GitLab", "Notion"])("connects %s through Brief's own start route, not Clerk", async (name) => {
    const github = account("oauth_github");
    clerk.user!.externalAccounts = [github];
    render(<Integrations />);
    await pick(name);
    fireEvent.click(screen.getByRole("button", { name: `Switch to ${name} →` }));

    expect(assign).toHaveBeenCalledWith(`/api/connect/${name.toLowerCase()}/start?returnTo=%2Fconnections`);
    expect(calls).not.toContain("createExternalAccount");
    expect(github.destroy).not.toHaveBeenCalled();
  });

  it("shows GitLab as connected from Brief's own store", async () => {
    owned = [ownedRow("gitlab")];
    render(<Integrations />);
    expect((await trigger()).textContent).toContain("GitLab");
    expect(screen.getByText("Connected ✓")).toBeTruthy();
  });

  it("leaves another owned tracker alone when switching to an owned one", async () => {
    owned = [ownedRow("clickup")];
    render(<Integrations />);
    await pick("Trello");
    fireEvent.click(screen.getByRole("button", { name: "Switch to Trello →" }));

    expect(assign).toHaveBeenCalledWith("/api/connect/trello/start?returnTo=%2Fconnections");
    expect(disconnectCalls()).toEqual([]);
  });

  it("drops an owned tracker once Clerk has the OAuth URL, then leaves for it", async () => {
    owned = [ownedRow("clickup")];
    render(<Integrations />);
    await pick("GitHub");
    fireEvent.click(screen.getByRole("button", { name: "Switch to GitHub →" }));

    await waitFor(() => expect(sentTo).toEqual(["https://github.com/login/oauth"]));
    const created = calls.indexOf("createExternalAccount");
    const dropped = calls.indexOf("POST /api/connect/clickup/disconnect");
    expect(created).toBeGreaterThanOrEqual(0);
    expect(dropped).toBeGreaterThan(created);
    expect(assign).not.toHaveBeenCalled();
  });

  it("drops a Clerk tracker only after Clerk has the OAuth URL", async () => {
    const linear = account("oauth_linear");
    linear.destroy.mockImplementation(async () => {
      calls.push("destroy linear");
    });
    clerk.user!.externalAccounts = [linear];
    render(<Integrations />);
    await pick("GitHub");
    fireEvent.click(screen.getByRole("button", { name: "Switch to GitHub →" }));

    await waitFor(() => expect(sentTo).toEqual(["https://github.com/login/oauth"]));
    expect(calls.indexOf("destroy linear")).toBeGreaterThan(calls.indexOf("createExternalAccount"));
  });

  it("keeps the current tracker when Clerk refuses the connect", async () => {
    const linear = account("oauth_linear");
    clerk.user!.externalAccounts = [linear];
    owned = [];
    clerk.user!.createExternalAccount.mockRejectedValue({
      errors: [{ message: "GitHub is not enabled", code: "strategy_for_user_invalid" }],
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Integrations />);
    await pick("GitHub");
    fireEvent.click(screen.getByRole("button", { name: "Switch to GitHub →" }));

    expect(await screen.findByText("GitHub is not enabled (strategy_for_user_invalid)")).toBeTruthy();
    expect(linear.destroy).not.toHaveBeenCalled();
    expect(disconnectCalls()).toEqual([]);
    expect(sentTo).toEqual([]);
  });

  it("drops an owned tracker connected since the page loaded before a Clerk connect", async () => {
    render(<Integrations />);
    await pick("Jira");
    // Connected in another tab after this page read its connections.
    owned = [ownedRow("asana")];
    fireEvent.click(screen.getByRole("button", { name: "Connect Jira →" }));

    await waitFor(() => expect(sentTo).toEqual(["https://github.com/login/oauth"]));
    expect(calls).toContain("POST /api/connect/asana/disconnect");
  });

  it("removes nothing when it can't read the owned trackers before a Clerk connect", async () => {
    owned = [ownedRow("clickup")];
    const linear = account("oauth_linear");
    clerk.user!.externalAccounts = [linear];
    render(<Integrations />);
    await pick("GitHub");
    // The page loaded fine; the read made at connect time fails.
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/me/connections") {
        calls.push(`GET ${url}`);
        return json({ error: "Could not load connections" }, false);
      }
      return server(url, init);
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch to GitHub →" }));

    expect(await screen.findByText("Couldn't disconnect ClickUp.")).toBeTruthy();
    expect(disconnectCalls()).toEqual([]);
    expect(linear.destroy).not.toHaveBeenCalled();
    expect(sentTo).toEqual([]);
  });

  it("blocks a Clerk connect when an owned tracker won't come off", async () => {
    owned = [ownedRow("clickup")];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/connect/clickup/disconnect") {
        calls.push(`POST ${url}`);
        return json({ error: "Could not disconnect" }, false);
      }
      return server(url, init);
    });
    render(<Integrations />);
    await pick("GitHub");
    fireEvent.click(screen.getByRole("button", { name: "Switch to GitHub →" }));

    expect(await screen.findByText("Couldn't disconnect ClickUp.")).toBeTruthy();
    expect(calls).toContain("POST /api/connect/clickup/disconnect");
    // Clerk's record is unverified until its OAuth lands: harmless, and the
    // browser never left for it.
    expect(sentTo).toEqual([]);
    expect(screen.getByRole("button", { name: "Switch to GitHub →" })).toHaveProperty("disabled", false);
  });

  it("drops a disconnected owned tracker even when the re-read fails", async () => {
    owned = [ownedRow("monday")];
    render(<Integrations />);
    const disconnectButton = await screen.findByRole("button", { name: "Disconnect" });
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/me/connections") return json({ error: "down" }, false);
      return server(url, init);
    });
    fireEvent.click(disconnectButton);

    expect(await screen.findByRole("button", { name: "Connect Monday →" })).toBeTruthy();
    expect(screen.queryByText("Connected ✓")).toBeNull();
  });

  it("disconnects an owned tracker through the server", async () => {
    owned = [ownedRow("monday")];
    render(<Integrations />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    expect(await screen.findByRole("button", { name: "Connect Monday →" })).toBeTruthy();
    expect(disconnectCalls()).toEqual(["POST /api/connect/monday/disconnect"]);
  });

  it("asks for a workspace pick rather than a reconnect", async () => {
    owned = [{ provider: "asana", label: "Razi", workspace: null }];
    health = { stale: [], needsWorkspace: ["asana"] };
    render(<Integrations />);
    expect(await screen.findByText("Workspace needed")).toBeTruthy();
    expect(screen.queryByText("Connected ✓")).toBeNull();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pick" }).getAttribute("href")).toBe("#team");
  });

  it("won't connect a tracker this deployment has no app for", async () => {
    configured = { ...configured, monday: false };
    render(<Integrations />);
    await pick("Monday");
    expect(screen.getByRole("button", { name: "Connect Monday →" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Not available yet")).toBeTruthy();
  });

  it("opens on the tracker a connect came back failing from, and cleans the address bar", async () => {
    clerk.user!.externalAccounts = [account("oauth_linear")];
    window.history.replaceState(null, "", "/connections?error=cancelled&provider=asana&tab=x");
    render(<Integrations />);

    expect((await trigger()).textContent).toContain("Asana");
    expect(screen.getByText("Connection cancelled")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch to Asana →" })).toBeTruthy();
    expect(window.location.pathname + window.location.search).toBe("/connections?tab=x");
  });

  it("names the missing Azure DevOps organization", async () => {
    window.history.replaceState(null, "", "/connections?error=no_org&provider=azure");
    render(<Integrations />);
    expect(await screen.findByText("No Azure DevOps organization on this account")).toBeTruthy();
  });

  it("never shows the raw error value", async () => {
    window.history.replaceState(null, "", "/connections?error=Visit%20evil.example&provider=trello");
    render(<Integrations />);
    expect(await screen.findByText("Couldn't connect")).toBeTruthy();
    expect(screen.queryByText(/evil/)).toBeNull();
  });

  it("shows an error for no known tracker on whichever card is showing", async () => {
    clerk.user!.externalAccounts = [account("oauth_linear")];
    window.history.replaceState(null, "", "/connections?error=failed&provider=nope");
    render(<Integrations />);
    expect((await trigger()).textContent).toContain("Linear");
    expect(screen.getByText("Couldn't connect")).toBeTruthy();
  });

  it("shows an error for no known tracker when nothing is connected or chosen", async () => {
    window.history.replaceState(null, "", "/connections?error=failed");
    render(<Integrations />);
    expect((await trigger()).textContent).toContain("Choose a tracker");
    expect(screen.getByText("Couldn't connect")).toBeTruthy();
  });

  const NO_ADO =
    "Azure DevOps isn't set up on this Microsoft organization yet. Create an organization at dev.azure.com, then connect again.";
  const ADO_DETAIL =
    "Azure DevOps: AADSTS650052: The app is trying to access a service '499b84ac-1321-427f-aa17-267ca6975798'(Azure DevOps) that your organization lacks a service principal for.";

  it("shows the server's explanation, and the provider's words beneath it, on the card the connect failed on", async () => {
    clerk.user!.externalAccounts = [account("oauth_linear")];
    window.history.replaceState(null, "", "/connections?error=failed&provider=azure");
    lastError = { provider: "azure", message: NO_ADO, detail: ADO_DETAIL };
    render(<Integrations />);

    expect((await trigger()).textContent).toContain("Azure DevOps");
    expect(screen.getByText(NO_ADO)).toBeTruthy();
    // It takes the place of the code's copy.
    expect(screen.queryByText("Couldn't connect")).toBeNull();
    const detail = screen.getByText(ADO_DETAIL);
    expect(detail.getAttribute("title")).toBe(ADO_DETAIL);
    expect(detail.className).toContain("line-clamp-3");
    expect(detail.className).toContain("break-words");
  });

  it("shows the server's explanation on its own tracker's card, whatever the URL names", async () => {
    window.history.replaceState(null, "", "/connections?error=Visit%20evil.example&provider=trello");
    lastError = { provider: "trello", message: "Connection cancelled" };
    render(<Integrations />);
    expect((await trigger()).textContent).toContain("Trello");
    expect(screen.getByText("Connection cancelled")).toBeTruthy();
    expect(screen.queryByText(/evil/)).toBeNull();
  });

  it("keeps the explanation when React reads the connections twice, as it does in development", async () => {
    window.history.replaceState(null, "", "/connections?error=failed&provider=azure");
    // The server hands the explanation out once.
    let reads = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url !== "/api/me/connections") return server(url, init);
      const once = reads++ === 0 ? { provider: "azure", message: NO_ADO, detail: ADO_DETAIL } : null;
      return json({ owned, configured, lastError: once });
    });
    render(
      <StrictMode>
        <Integrations />
      </StrictMode>,
    );
    expect(await screen.findByText(ADO_DETAIL)).toBeTruthy();
    expect(screen.getByText(NO_ADO)).toBeTruthy();
    expect(reads).toBe(2);
  });

  it("keeps the code's copy when the server has no explanation", async () => {
    window.history.replaceState(null, "", "/connections?error=failed&provider=azure");
    render(<Integrations />);
    expect((await trigger()).textContent).toContain("Azure DevOps");
    expect(screen.getByText("Couldn't connect")).toBeTruthy();
  });

  it("drops the message and its detail once Connect is clicked again", async () => {
    window.history.replaceState(null, "", "/connections?error=failed&provider=azure");
    lastError = { provider: "azure", message: NO_ADO, detail: ADO_DETAIL };
    render(<Integrations />);
    await screen.findByText(ADO_DETAIL);
    fireEvent.click(screen.getByRole("button", { name: "Connect Azure DevOps →" }));
    expect(assign).toHaveBeenCalledWith("/api/connect/azure/start?returnTo=%2Fconnections");
    expect(screen.queryByText(NO_ADO)).toBeNull();
    expect(screen.queryByText(ADO_DETAIL)).toBeNull();
  });

  it("names the missing Jira site", async () => {
    window.history.replaceState(null, "", "/connections?error=no_workspace&provider=jira");
    render(<Integrations />);
    expect(await screen.findByText("No Jira site on this account")).toBeTruthy();
  });

  it("strips a successful connect's marker and keeps the workspace pick", async () => {
    window.history.replaceState(null, "", "/connections?connected=asana&pick=asana");
    render(<Integrations />);
    await trigger();
    expect(window.location.search).toBe("?pick=asana");
  });
});

describe("Linear, Jira and GitHub while they move off Clerk", () => {
  it("connects Linear through Brief's start route once this deployment has Brief's app for it", async () => {
    configured = { ...configured, linear: true };
    const github = account("oauth_github");
    clerk.user!.externalAccounts = [github];
    render(<Integrations />);
    await pick("Linear");
    fireEvent.click(screen.getByRole("button", { name: "Switch to Linear →" }));

    expect(assign).toHaveBeenCalledWith("/api/connect/linear/start?returnTo=%2Fconnections");
    expect(calls).not.toContain("createExternalAccount");
    // The callback removes the Clerk account once the new one is stored.
    expect(github.destroy).not.toHaveBeenCalled();
    expect(disconnectCalls()).toEqual([]);
  });

  it("still connects Jira through Clerk when Brief's app for it is not set up here", async () => {
    render(<Integrations />);
    await pick("Jira");
    const connect = screen.getByRole("button", { name: "Connect Jira →" });
    // Available: Clerk can still connect it.
    expect(connect).toHaveProperty("disabled", false);
    expect(screen.queryByText("Not available yet")).toBeNull();
    fireEvent.click(connect);

    await waitFor(() => expect(sentTo).toEqual(["https://github.com/login/oauth"]));
    expect(clerk.user!.createExternalAccount).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: "oauth_atlassian" }),
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it("asks the server again when it couldn't tell which flow Jira uses, and follows the answer", async () => {
    let reads = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      // The read on page load fails; the one made at click time answers.
      if (url === "/api/me/connections" && reads++ === 0) return json({ error: "down" }, false);
      return server(url, init);
    });
    configured = { ...configured, jira: true };
    render(<Integrations />);
    await pick("Jira");
    fireEvent.click(screen.getByRole("button", { name: "Connect Jira →" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/api/connect/jira/start?returnTo=%2Fconnections"));
    expect(calls).not.toContain("createExternalAccount");
  });

  it("shows an error, rather than guess Clerk, when it still can't tell which flow Jira uses", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/me/connections") return json({ error: "down" }, false);
      return server(url, init);
    });
    render(<Integrations />);
    await pick("Jira");
    fireEvent.click(screen.getByRole("button", { name: "Connect Jira →" }));

    expect(await screen.findByText("Couldn't connect")).toBeTruthy();
    expect(calls).not.toContain("createExternalAccount");
    expect(assign).not.toHaveBeenCalled();
    expect(sentTo).toEqual([]);
  });

  it("drops the tracker's own Brief row, not its new Clerk account, when reconnecting it through Clerk", async () => {
    // A Brief GitHub row whose token is dead, on a deployment that connects
    // GitHub through Clerk: the row would keep the new Clerk account from filing.
    owned = [ownedRow("github")];
    health = { stale: ["github"], needsWorkspace: [] };
    render(<Integrations />);
    fireEvent.click(await screen.findByRole("button", { name: "Reconnect →" }));

    await waitFor(() => expect(sentTo).toEqual(["https://github.com/login/oauth"]));
    expect(disconnectCalls()).toEqual(["POST /api/connect/github/disconnect?clerk=keep"]);
    expect(calls.indexOf("POST /api/connect/github/disconnect?clerk=keep")).toBeGreaterThan(
      calls.indexOf("createExternalAccount"),
    );
  });

  it("shows Linear as connected from Brief's own store", async () => {
    configured = { ...configured, linear: true };
    owned = [ownedRow("linear")];
    render(<Integrations />);
    expect((await trigger()).textContent).toContain("Linear");
    expect(screen.getByText("Connected ✓")).toBeTruthy();
  });

  it("still shows a GitHub connected through Clerk before the move as connected", async () => {
    configured = { ...configured, github: true };
    clerk.user!.externalAccounts = [account("oauth_github")];
    render(<Integrations />);
    expect((await trigger()).textContent).toContain("GitHub");
    expect(screen.getByText("Connected ✓")).toBeTruthy();
  });

  it("disconnects a Clerk-connected GitHub through the server, which removes the Clerk account", async () => {
    const github = account("oauth_github");
    clerk.user!.externalAccounts = [github];
    render(<Integrations />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(disconnectCalls()).toEqual(["POST /api/connect/github/disconnect"]));
    await waitFor(() => expect(clerk.user!.reload).toHaveBeenCalled());
    expect(github.destroy).not.toHaveBeenCalled();
  });

  describe("Reconnect, for a tracker still on Clerk", () => {
    const update = () => screen.queryByRole("button", { name: "Reconnect" });

    it.each([
      ["linear", "oauth_linear"],
      ["jira", "oauth_atlassian"],
      ["github", "oauth_github"],
    ] as const)("moves %s through Brief's start route and disconnects nothing", async (key, provider) => {
      configured = { ...configured, [key]: true };
      const held = account(provider);
      clerk.user!.externalAccounts = [held];
      render(<Integrations />);
      fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));

      expect(assign).toHaveBeenCalledWith(`/api/connect/${key}/start?returnTo=%2Fconnections`);
      expect(held.destroy).not.toHaveBeenCalled();
      expect(disconnectCalls()).toEqual([]);
      expect(calls).not.toContain("createExternalAccount");
      expect(sentTo).toEqual([]);
      // Still connected while the browser leaves for the provider.
      expect(screen.getByText("Connected ✓")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Reconnecting…" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Disconnect" })).toHaveProperty("disabled", true);
    });

    it("isn't offered when Brief's app for it is not set up here", async () => {
      clerk.user!.externalAccounts = [account("oauth_linear")];
      render(<Integrations />);
      await screen.findByText("Connected ✓");
      expect(update()).toBeNull();
    });

    it("isn't offered when the page couldn't tell whether Brief's app is set up", async () => {
      configured = { ...configured, linear: true };
      clerk.user!.externalAccounts = [account("oauth_linear")];
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === "/api/me/connections") return json({ error: "down" }, false);
        return server(url, init);
      });
      render(<Integrations />);
      await screen.findByText("Connected ✓");
      expect(update()).toBeNull();
    });

    it("isn't offered once Brief holds the tracker, even beside a Clerk account the page still sees", async () => {
      configured = { ...configured, linear: true };
      owned = [ownedRow("linear")];
      clerk.user!.externalAccounts = [account("oauth_linear")];
      render(<Integrations />);
      await screen.findByText("Connected ✓");
      expect(update()).toBeNull();
    });

    it("isn't offered for a tracker Brief always held", async () => {
      owned = [ownedRow("asana")];
      configured = Object.fromEntries(Object.keys(configured).map((k) => [k, true]));
      render(<Integrations />);
      await screen.findByText("Connected ✓");
      expect(update()).toBeNull();
    });

    it("shows Connected, and no Reconnect, back from a move that worked", async () => {
      configured = { ...configured, github: true };
      // The callback stored the row and removed the Clerk account.
      owned = [ownedRow("github")];
      window.history.replaceState(null, "", "/connections?connected=github");
      render(<Integrations />);

      expect((await trigger()).textContent).toContain("GitHub");
      expect(screen.getByText("Connected ✓")).toBeTruthy();
      expect(update()).toBeNull();
      expect(window.location.search).toBe("");
    });

    it("keeps the Clerk connection, with the error on its card, back from a move that failed", async () => {
      configured = { ...configured, linear: true };
      const held = account("oauth_linear");
      clerk.user!.externalAccounts = [held];
      window.history.replaceState(null, "", "/connections?error=failed&provider=linear");
      lastError = { provider: "linear", message: "Couldn't connect", detail: "Linear: invalid_grant" };
      render(<Integrations />);

      expect((await trigger()).textContent).toContain("Linear");
      expect(await screen.findByText("Linear: invalid_grant")).toBeTruthy();
      expect(screen.getByText("Couldn't connect")).toBeTruthy();
      expect(screen.getByText("Connected ✓")).toBeTruthy();
      // Still on offer, and nothing was removed.
      expect(update()).toBeTruthy();
      expect(held.destroy).not.toHaveBeenCalled();
      expect(disconnectCalls()).toEqual([]);
    });
  });

  it("points to account settings when a Clerk account the server couldn't remove is left", async () => {
    clerk.user!.externalAccounts = [account("oauth_linear")];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/connect/linear/disconnect") {
        calls.push(`POST ${url}`);
        return json({ error: "failed" }, false);
      }
      return server(url, init);
    });
    render(<Integrations />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    expect(await screen.findByRole("link", { name: "manage connections in account settings" })).toBeTruthy();
  });
});
