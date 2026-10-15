// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import WorkspacePicker from "./WorkspacePicker";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

const WORKSPACES = [
  { id: "101", name: "Acme", avatarUrl: "https://avatars.test/acme" },
  { id: "102", name: "Beta" },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockClear();
});

describe("WorkspacePicker", () => {
  it("names the tracker's workspace and offers each one", () => {
    render(<WorkspacePicker provider="gitlab" providerName="GitLab" noun="group" workspaces={WORKSPACES} />);
    expect(screen.getByText("Your GitLab group")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Acme" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Beta" })).toBeTruthy();
  });

  it("posts the pick for its provider, then re-renders the page", async () => {
    render(<WorkspacePicker provider="clickup" providerName="ClickUp" noun="workspace" workspaces={WORKSPACES} />);
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/org/workspace");
    expect(JSON.parse(init.body)).toEqual({ provider: "clickup", id: "102" });
  });

  it("shows the server's reason when the pick is refused", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "That workspace isn't on your ClickUp account." }),
    });
    render(<WorkspacePicker provider="clickup" providerName="ClickUp" noun="workspace" workspaces={WORKSPACES} />);
    fireEvent.click(screen.getByRole("button", { name: "Acme" }));

    expect(await screen.findByText("That workspace isn't on your ClickUp account.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    // The buttons work again after a refusal.
    expect((screen.getByRole("button", { name: "Acme" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
