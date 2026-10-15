// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ProviderKey } from "./provider-labels";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

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

import Onboarding from "./Onboarding";

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
    vi.fn(async (url: string) => {
      if (url === "/api/me/connections") return { ok: true, json: async () => connections };
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

const renderWizard = () =>
  render(<Onboarding initialRole="Engineer" initialSource="" greetingName="Razi" />);

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
