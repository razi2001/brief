// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ProviderKey } from "./provider-labels";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
// The demo has its own tests; here it only has to hand back onOpenGuide.
vi.mock("./onboarding/TryItDemo", () => ({
  default: ({ onOpenGuide }: { onOpenGuide: () => void }) => (
    <button type="button" onClick={onOpenGuide}>
      Open the Guide
    </button>
  ),
}));

const clerk = vi.hoisted(() => ({
  createExternalAccount: null as null | ReturnType<typeof vi.fn>,
}));
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    isLoaded: true,
    user: {
      id: "user_1",
      externalAccounts: [],
      reload: async () => {},
      createExternalAccount: clerk.createExternalAccount,
    },
  }),
  useReverification: <A extends unknown[], R>(fn: (...a: A) => R) => fn,
}));

import Onboarding, { type OnboardingReplay } from "./Onboarding";

type Connections = {
  owned: Array<{ provider: ProviderKey; label: string | null; workspace: null }>;
  configured: Record<string, boolean>;
  lastError?: { provider: ProviderKey; message: string; detail?: string } | null;
};

let connections: Promise<Connections>;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.history.replaceState(null, "", "/welcome");
  connections = Promise.resolve({
    owned: [],
    configured: { gitlab: true, azure: true, clickup: true, notion: true, trello: true, asana: true, monday: false },
  });
  clerk.createExternalAccount = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/me/connections") return { ok: true, json: async () => connections };
      // The Replay step saves the whole list and shows what the server kept.
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (url === "/api/settings" && body.replaySites) return { ok: true, json: async () => ({ ok: true, replaySites: body.replaySites }) };
      return { ok: true, json: async () => ({}) };
    }),
  );
  // jsdom's location methods can't be spied on; swap the global for one that
  // records the navigation.
  assign = vi.fn();
  const real = window.location;
  vi.stubGlobal("location", {
    get href() {
      return real.href;
    },
    get origin() {
      return real.origin;
    },
    get search() {
      return real.search;
    },
    get pathname() {
      return real.pathname;
    },
    get hash() {
      return real.hash;
    },
    assign,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NO_REPLAY: OnboardingReplay = { team: null, mine: [], mode: "inherit" };

const renderWizard = (replay: OnboardingReplay = NO_REPLAY) =>
  render(<Onboarding initialRole="Engineer" initialSource="" greetingName="Razi" replay={replay} />);

const row = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

describe("Onboarding's tracker step", () => {
  it("connects an owned tracker through Brief's start route", async () => {
    renderWizard();
    await screen.findByText("Connect your tracker");
    fireEvent.click(row("Asana"));

    expect(assign).toHaveBeenCalledWith("/api/connect/asana/start?returnTo=%2Fwelcome");
    expect(clerk.createExternalAccount).not.toHaveBeenCalled();
    // Each connect navigates away, so the rest wait.
    expect(row("Linear")).toHaveProperty("disabled", true);
    expect(row("Trello")).toHaveProperty("disabled", true);
  });

  it("won't connect a tracker this deployment can't connect yet", async () => {
    renderWizard();
    await screen.findByText("Connect your tracker");
    const monday = row("Monday");
    expect(monday).toHaveProperty("disabled", true);
    expect(monday.textContent).toContain("Not available yet");
    expect(row("Asana")).toHaveProperty("disabled", false);
  });

  it("shows the server's explanation of a failed connect, and the provider's words, under that tracker", async () => {
    window.history.replaceState(null, "", "/welcome?error=failed&provider=azure");
    const detail = "Azure DevOps: AADSTS650052: The app is trying to access a service (Azure DevOps).";
    connections = Promise.resolve({
      owned: [],
      configured: { azure: true },
      lastError: { provider: "azure", message: "Use a work or school Microsoft account.", detail },
    });
    renderWizard();
    await screen.findByText("Connect your tracker");

    const message = await screen.findByText("Use a work or school Microsoft account.");
    const shown = screen.getByText(detail);
    expect(shown.getAttribute("title")).toBe(detail);
    // Both sit under the Azure DevOps row.
    const azureRow = row("Azure DevOps").parentElement!;
    expect(azureRow.contains(message)).toBe(true);
    expect(azureRow.contains(shown)).toBe(true);
    expect(screen.queryByText("Couldn't connect")).toBeNull();
  });

  it("waits for the owned trackers before choosing the step", async () => {
    let answer!: (c: Connections) => void;
    connections = new Promise((r) => (answer = r));
    renderWizard();
    // Back from connecting Asana: the tracker step must not flash first.
    expect(screen.queryByText("Connect your tracker")).toBeNull();
    await act(async () => answer({ owned: [{ provider: "asana", label: null, workspace: null }], configured: {} }));

    expect(await screen.findByText("Install the extension")).toBeTruthy();
    expect(screen.queryByText("Connect your tracker")).toBeNull();
  });
});

describe("Onboarding's extension step", () => {
  beforeEach(() => {
    localStorage.clear();
    connections = Promise.resolve({ owned: [{ provider: "asana", label: null, workspace: null }], configured: {} });
  });

  it("names no button the popup doesn't have", async () => {
    renderWizard();
    await screen.findByText("Install the extension");
    expect(screen.getByRole("link", { name: /Add to Chrome/ })).toBeTruthy();
    expect(screen.queryByText(/Connect to Brief Cloud/)).toBeNull();
  });

  it("shows the extension connected once it pairs with this account, in this tab or the setup tab", async () => {
    renderWizard();
    await screen.findByText("Install the extension");

    // ExtensionTokenSync (or /connect in the setup tab) paired it as this user.
    localStorage.setItem("briefExtSyncedUser", "user_1");
    await act(async () => window.dispatchEvent(new Event("brief-ext-paired")));

    expect(screen.getByText("Extension connected")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Add to Chrome/ })).toBeNull();
  });

  it("doesn't count a pairing made as someone else", async () => {
    localStorage.setItem("briefExtSyncedUser", "user_2");
    renderWizard();
    expect(await screen.findByText("Install the extension")).toBeTruthy();
    expect(screen.queryByText("Extension connected")).toBeNull();
  });
});

describe("Onboarding's Try it step", () => {
  beforeEach(() => {
    localStorage.clear();
    router.replace.mockClear();
    connections = Promise.resolve({ owned: [{ provider: "asana", label: null, workspace: null }], configured: {} });
  });
  const settingsPosts = () =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter(([url]) => url === "/api/settings")
      .map(([, init]) => JSON.parse((init as RequestInit).body as string));
  const continueBtn = () => screen.getByRole("button", { name: "Continue" });
  const toTryIt = async () => {
    renderWizard();
    await screen.findByText("Install the extension");
    fireEvent.click(continueBtn());
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    await screen.findByRole("heading", { name: "Try it" });
  };

  it("has five steps on the rail", async () => {
    renderWizard();
    await screen.findByText("Install the extension");
    const rail = within(screen.getByRole("list", { name: "Setup steps" })).getAllByRole("listitem");
    expect(rail.map((li) => li.textContent?.replace(/\d/g, ""))).toEqual(["You", "Tracker", "Extension", "Replay", "Try it"]);
  });

  it("goes from the extension step through Replay to Try it", async () => {
    await toTryIt();
    expect(screen.getByText("Report two bugs. About a minute.")).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("makes Continue the accent button once the extension is connected", async () => {
    renderWizard();
    await screen.findByText("Install the extension");
    expect(continueBtn().className).not.toMatch(/btn-accent/);
    localStorage.setItem("briefExtSyncedUser", "user_1");
    await act(async () => window.dispatchEvent(new Event("brief-ext-paired")));
    expect(continueBtn().className).toMatch(/btn-accent/);
  });

  it("All set, take me home: saves onboardedAt and goes to the dashboard", async () => {
    await toTryIt();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "All set, take me home" })));
    expect(settingsPosts()).toContainEqual({ onboardedAt: true });
    expect(router.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("Open the Guide: saves onboardedAt and goes to the Guide", async () => {
    await toTryIt();
    const guide = await screen.findByRole("button", { name: "Open the Guide" });
    await act(async () => fireEvent.click(guide));
    expect(settingsPosts()).toContainEqual({ onboardedAt: true });
    expect(router.replace).toHaveBeenCalledWith("/guide");
  });

  it("hides Skip setup only on Try it", async () => {
    renderWizard();
    await screen.findByText("Install the extension");
    expect(screen.getByRole("button", { name: "Skip setup, straight home" })).toBeTruthy();
    fireEvent.click(continueBtn());
    await screen.findByRole("heading", { name: "Turn on Replay" });
    expect(screen.getByRole("button", { name: "Skip setup, straight home" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await screen.findByRole("heading", { name: "Try it" });
    expect(screen.queryByRole("button", { name: "Skip setup, straight home" })).toBeNull();
  });

  it("goes back from Try it to the Replay step, then to the extension step", async () => {
    await toTryIt();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Turn on Replay" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open the Guide" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Install the extension")).toBeTruthy();
  });
});

describe("Onboarding's Replay step", () => {
  beforeEach(() => {
    localStorage.clear();
    router.refresh.mockClear();
    connections = Promise.resolve({ owned: [{ provider: "asana", label: null, workspace: null }], configured: {} });
  });
  const toReplay = async (replay?: OnboardingReplay) => {
    renderWizard(replay);
    await screen.findByText("Install the extension");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  };
  const railItem = (label: string) =>
    within(screen.getByRole("list", { name: "Setup steps" }))
      .getAllByRole("listitem")
      .find((li) => li.textContent?.includes(label))!;

  it("asks for a site, with Not now, when no sites are set", async () => {
    await toReplay();
    expect(await screen.findByRole("heading", { name: "Turn on Replay" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Site" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not now" }).className).not.toMatch(/btn-accent/);
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.queryByText("Replay on")).toBeNull();
  });

  it("saves a site added here as the user's own and refreshes the page's data", async () => {
    await toReplay();
    fireEvent.change(await screen.findByRole("textbox", { name: "Site" }), { target: { value: "app.acme.com" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add" })));

    const posts = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter(([url]) => url === "/api/settings")
      .map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(posts).toContainEqual({ replaySites: ["app.acme.com"] });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows Replay on, the team's sites and an accent Continue when the team already records", async () => {
    await toReplay({ team: { name: "Acme", sites: ["app.acme.com"], members: 3 }, mine: [], mode: "inherit" });
    expect(await screen.findByRole("heading", { name: "Replay is on" })).toBeTruthy();
    expect(screen.getByText("Replay on")).toBeTruthy();
    expect(screen.getByText("app.acme.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" }).className).toMatch(/btn-accent/);
    expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
    // Ticked on the rail, not numbered.
    expect(within(railItem("Replay")).queryByText("4")).toBeNull();
  });

  it("goes by the user's own list when they don't follow the team", async () => {
    await toReplay({ team: { name: "Acme", sites: ["app.acme.com"], members: 3 }, mine: [], mode: "override" });
    expect(await screen.findByRole("heading", { name: "Turn on Replay" })).toBeTruthy();
    expect(within(railItem("Replay")).getByText("4")).toBeTruthy();
  });
});
