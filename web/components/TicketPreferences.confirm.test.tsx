// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TicketPreferences from "./TicketPreferences";

// The GitHub org picker uses the router; stub it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const baseProps = {
  mode: "inherit" as const,
  personal: "Always assign to me.",
  org: "Status: Triage.",
  orgName: "Acme",
  orgMembers: 6,
  hasOrg: true,
  orgUpdatedByName: "Jonas",
  orgUpdatedAt: "2026-09-02T10:00:00.000Z",
  needsGithubOrg: false,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, members: 6, updatedByName: "Razi" }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function editTeamDefaults(value: string) {
  const boxes = screen.getAllByRole("textbox");
  fireEvent.change(boxes[0], { target: { value } });
}

describe("changing the team defaults", () => {
  it("does not write anything until the change is confirmed", async () => {
    render(<TicketPreferences {...baseProps} />);
    editTeamDefaults("Status: Backlog.");
    fireEvent.click(screen.getByText("Save for the team"));

    expect(screen.getByRole("dialog")).toBeTruthy();
    // The dialog is open, but nothing has been saved yet.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tells you how many people the change affects", () => {
    render(<TicketPreferences {...baseProps} />);
    editTeamDefaults("Status: Backlog.");
    fireEvent.click(screen.getByText("Save for the team"));

    expect(screen.getByRole("dialog").textContent).toContain("6 people");
    expect(screen.getByRole("dialog").textContent).toContain("Acme");
  });

  it("shows which lines are being removed and added", () => {
    render(<TicketPreferences {...baseProps} />);
    editTeamDefaults("Status: Backlog.");
    fireEvent.click(screen.getByText("Save for the team"));

    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).toContain("− Status: Triage.");
    expect(text).toContain("+ Status: Backlog.");
  });

  it("writes to the org endpoint once confirmed", async () => {
    render(<TicketPreferences {...baseProps} />);
    editTeamDefaults("Status: Backlog.");
    fireEvent.click(screen.getByText("Save for the team"));
    fireEvent.click(screen.getByText("Update for everyone"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/org/settings");
    expect(JSON.parse(init.body).ticketGuidance).toBe("Status: Backlog.");
  });

  it("writes nothing when the change is cancelled", async () => {
    render(<TicketPreferences {...baseProps} />);
    editTeamDefaults("Status: Backlog.");
    fireEvent.click(screen.getByText("Save for the team"));
    fireEvent.click(screen.getByText("Cancel"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("can't be saved when nothing changed - no dialog for a no-op", () => {
    render(<TicketPreferences {...baseProps} />);
    const save = screen.getByText("Save for the team") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
});

describe("the personal override", () => {
  it("saves without a confirmation - it only affects you", async () => {
    render(<TicketPreferences {...baseProps} mode="override" />);
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/settings");
  });

  it("shows the team text read-only while inheriting", () => {
    render(<TicketPreferences {...baseProps} mode="inherit" />);
    // One textbox only: the team defaults. The personal box is replaced by a
    // read-only preview of what's actually in force.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    // Scoped to a div so this matches the read-only preview, not the team
    // textarea that happens to hold the same text.
    expect(screen.getByText("Status: Triage.", { selector: "div" })).toBeTruthy();
  });

  it("switching to your own persists the mode straight away", async () => {
    render(<TicketPreferences {...baseProps} mode="inherit" />);
    fireEvent.click(screen.getByText("Use my own"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/settings");
    expect(JSON.parse(init.body).ticketGuidanceMode).toBe("override");
  });
});

describe("alone in the org", () => {
  const solo = { ...baseProps, orgMembers: 1, orgUpdatedByName: "" };

  it("still offers team defaults - teammates will arrive later", () => {
    render(<TicketPreferences {...solo} />);
    expect(screen.getByText("Team defaults")).toBeTruthy();
  });

  it("says it is just you, not '1 person'", () => {
    const { container } = render(<TicketPreferences {...solo} />);
    expect(container.textContent).toContain("Acme · just you");
    expect(container.textContent).not.toContain("1 person");
  });

  it("explains the point: these apply to whoever joins", () => {
    const { container } = render(<TicketPreferences {...solo} />);
    expect(container.textContent).toContain("anyone who joins Acme");
  });

  it("does not claim the change affects everyone else", () => {
    render(<TicketPreferences {...solo} />);
    editTeamDefaults("Status: Backlog.");
    fireEvent.click(screen.getByText("Save for the team"));

    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).not.toContain("Change defaults for 1 person");
    expect(text).toContain("only one here");
    expect(text).toContain("anyone who joins");
  });

  it("still confirms, and still shows the diff", () => {
    render(<TicketPreferences {...solo} />);
    editTeamDefaults("Status: Backlog.");
    fireEvent.click(screen.getByText("Save for the team"));

    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).toContain("− Status: Triage.");
    expect(text).toContain("+ Status: Backlog.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("with no org", () => {
  it("offers only personal preferences and never a team card", () => {
    render(<TicketPreferences {...baseProps} hasOrg={false} mode="override" />);
    expect(screen.queryByText("Team defaults")).toBeNull();
    expect(screen.getByText("Your preferences")).toBeTruthy();
    expect(screen.getByText("Only affects your tickets")).toBeTruthy();
  });
});
