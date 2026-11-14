// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import RequestsView from "./RequestsView";
import type { RequestItem } from "@/lib/requests";

const item = (over: Partial<RequestItem>): RequestItem => ({
  id: "id",
  title: "A request",
  body: "",
  status: "open",
  createdAt: new Date().toISOString(),
  votes: 1,
  voted: false,
  mine: false,
  ...over,
});

const initial = [
  item({ id: "a", title: "Dark mode", votes: 4 }),
  item({ id: "b", title: "Export to PDF", votes: 2, status: "planned", mine: true, voted: true }),
  item({ id: "c", title: "Slack alerts", votes: 7, status: "shipped" }),
];

let fetchMock: ReturnType<typeof vi.fn>;
const reply = (ok: boolean, status = ok ? 200 : 500, json: unknown = { ok }) => ({ ok, status, json: async () => json });

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(reply(true));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const titles = () => screen.getAllByRole("listitem").map((li) => li.querySelector("p")?.textContent);

describe("the Requests list", () => {
  it("is titled Feature requests and tells people they help build Brief by sending and voting", () => {
    render(<RequestsView initial={initial} admin={false} />);
    expect(screen.getByRole("heading", { name: "Feature requests" })).toBeTruthy();
    expect(screen.getByText(/Help us build Brief\. Send an idea, vote for what matters, and see it ship\./)).toBeTruthy();
  });

  it("lists the most voted first, and the newest first on New", () => {
    render(<RequestsView initial={initial} admin={false} />);
    expect(titles()).toEqual(["Slack alerts", "Dark mode", "Export to PDF"]);
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(titles()).toHaveLength(3);
  });

  it("filters by status, with a count on each chip", () => {
    render(<RequestsView initial={initial} admin={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Shipped/ }));
    expect(titles()).toEqual(["Slack alerts"]);
    fireEvent.click(screen.getByRole("button", { name: /All/ }));
    expect(titles()).toHaveLength(3);
  });

  it("shows a regular user read-only statuses", () => {
    render(<RequestsView initial={initial} admin={false} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Shipped", { selector: "li span" })).toBeTruthy();
  });

  it("gives the owner a status control per row", () => {
    render(<RequestsView initial={initial} admin />);
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });

  it("is anonymous: the only identity it ever shows is 'You' on your own request, to the owner too", () => {
    for (const admin of [false, true]) {
      cleanup();
      render(<RequestsView initial={initial} admin={admin} />);
      expect(screen.getAllByText("You")).toHaveLength(1);
      expect(screen.getByText("Export to PDF").closest("li")?.textContent).toContain("You");
      expect(screen.getByText("Dark mode").closest("li")?.textContent).not.toContain("You");
    }
  });
});

describe("voting", () => {
  it("adds a vote straight away and sends it", async () => {
    render(<RequestsView initial={initial} admin={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Vote for Dark mode" }));

    const pressed = screen.getByRole("button", { name: "Remove your vote from Dark mode" });
    expect(pressed.textContent).toBe("5");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/requests/a/vote");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ voted: true });
  });

  it("takes a vote back off", async () => {
    render(<RequestsView initial={initial} admin={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove your vote from Export to PDF" }));
    expect(screen.getByRole("button", { name: "Vote for Export to PDF" }).textContent).toBe("1");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ voted: false });
  });

  it("treats a redirect to sign-in as a failed save, not a saved vote", async () => {
    fetchMock.mockResolvedValue({ ...reply(true, 200), redirected: true });
    render(<RequestsView initial={initial} admin={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Vote for Dark mode" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Vote for Dark mode" }).textContent).toBe("4"));
  });

  it("puts the count back when the save fails", async () => {
    fetchMock.mockResolvedValue(reply(false));
    render(<RequestsView initial={initial} admin={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Vote for Dark mode" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Vote for Dark mode" }).textContent).toBe("4"));
  });
});

describe("the vote button", () => {
  it("is a thumbs up that fills in once you've voted", () => {
    render(<RequestsView initial={initial} admin={false} />);
    const hand = (name: string) => screen.getByRole("button", { name }).querySelector("svg path")!;
    expect(hand("Vote for Dark mode").getAttribute("fill")).toBe("none");
    expect(hand("Remove your vote from Export to PDF").getAttribute("fill")).toBe("currentColor");
    fireEvent.click(screen.getByRole("button", { name: "Vote for Dark mode" }));
    expect(hand("Remove your vote from Dark mode").getAttribute("fill")).toBe("currentColor");
  });
});

describe("showing everything", () => {
  it("never crops a long request, and has nothing that could", () => {
    const body = "word ".repeat(150).trim();
    const long = "x".repeat(120);
    const { container } = render(
      <RequestsView initial={[item({ id: "x", title: long, body, mine: true })]} admin={false} />,
    );
    expect(screen.getByText(body)).toBeTruthy();
    expect(screen.getByText(long)).toBeTruthy();
    expect(container.querySelector('[class*="line-clamp"]')).toBeNull();
    expect(container.querySelector('[class*="truncate"]')).toBeNull();
  });
});

describe("deleting a request", () => {
  const deleteButtons = () => screen.queryAllByRole("button", { name: /^Delete / });

  it("is offered on your own requests only", () => {
    render(<RequestsView initial={initial} admin={false} />);
    expect(deleteButtons().map((b) => b.getAttribute("aria-label"))).toEqual(["Delete Export to PDF"]);
  });

  it("is offered on every request to the owner, who still sees no names", () => {
    render(<RequestsView initial={initial} admin />);
    expect(deleteButtons().map((b) => b.getAttribute("aria-label")).sort()).toEqual([
      "Delete Dark mode",
      "Delete Export to PDF",
      "Delete Slack alerts",
    ]);
    expect(screen.getAllByText("You")).toHaveLength(1);
  });

  it("lets the owner delete someone else's request, asking first", async () => {
    render(<RequestsView initial={initial} admin />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Dark mode" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete Dark mode" }));

    expect(screen.queryByText("Dark mode")).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/requests/a");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("asks first, and Keep changes nothing", () => {
    render(<RequestsView initial={initial} admin={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Export to PDF" }));
    expect(screen.getByText("Delete this request?")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.queryByText("Delete this request?")).toBeNull();
    expect(screen.getByText("Export to PDF")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("removes it at once and sends the delete once confirmed", async () => {
    render(<RequestsView initial={initial} admin={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Export to PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete Export to PDF" }));

    expect(screen.queryByText("Export to PDF")).toBeNull();
    expect(screen.getByRole("button", { name: /All/ }).textContent).toContain("2");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/requests/b");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("puts it back when the delete fails", async () => {
    fetchMock.mockResolvedValue(reply(false));
    render(<RequestsView initial={initial} admin={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Export to PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete Export to PDF" }));
    await waitFor(() => expect(screen.getByText("Export to PDF")).toBeTruthy());
  });

  it("treats 'already gone' as done", async () => {
    fetchMock.mockResolvedValue(reply(false, 404));
    render(<RequestsView initial={initial} admin={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Export to PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete Export to PDF" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Export to PDF")).toBeNull();
  });
});

describe("the owner's status control", () => {
  it("changes the status at once and saves it", async () => {
    render(<RequestsView initial={initial} admin />);
    const select = screen.getByLabelText("Status of Dark mode") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "in_progress" } });

    expect(select.value).toBe("in_progress");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/requests/a");
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: "in_progress" });
  });

  it("goes back to the old status when the save fails", async () => {
    fetchMock.mockResolvedValue(reply(false));
    render(<RequestsView initial={initial} admin />);
    const select = screen.getByLabelText("Status of Dark mode") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "declined" } });
    await waitFor(() => expect(select.value).toBe("open"));
  });
});

describe("sending a request", () => {
  it("sends it, adds it to the top with your vote, and clears the box", async () => {
    fetchMock.mockResolvedValue(reply(true, 200, { ok: true, id: "new", createdAt: new Date().toISOString() }));
    render(<RequestsView initial={initial} admin={false} />);

    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const box = screen.getByLabelText("Request") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "  Keyboard   shortcuts " } });
    fireEvent.click(send);

    await waitFor(() => expect(screen.getByRole("button", { name: "Remove your vote from Keyboard shortcuts" })).toBeTruthy());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ title: "  Keyboard   shortcuts ", body: "" });
    expect(box.value).toBe("");
  });

  it("says so when the daily limit is hit, and keeps what was typed", async () => {
    fetchMock.mockResolvedValue(reply(false, 429, { error: "limit" }));
    render(<RequestsView initial={initial} admin={false} />);
    const box = screen.getByLabelText("Request") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "One more idea" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/five today/i)).toBeTruthy();
    expect(box.value).toBe("One more idea");
  });
});
