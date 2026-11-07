// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import NudgePeople, { type CardPerson } from "./NudgePeople";

const NOW = Date.UTC(2026, 10, 7, 12);
const person = (o: Partial<CardPerson>): CardPerson => ({
  id: "user_a", name: "Ada Lovelace", email: "ada@acme.com", image: null, extension: true, lastSeen: null, card: null, ...o,
});
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const people = [
  person({ id: "user_a", lastSeen: new Date(NOW - 3 * 86_400_000).toISOString(), card: { at: "2026-11-06T10:00:00Z", status: "closed" } }),
  person({ id: "user_c", name: "Alan Turing", email: "alan@bletchley.uk", card: { at: "2026-11-06T10:00:00Z", status: "briefed" } }),
  person({ id: "user_b", name: "Grace Hopper", email: "grace@navy.mil", extension: false }),
];

describe("NudgePeople", () => {
  it("lists everyone with what they did with the last reminder", () => {
    render(<NudgePeople people={people} now={NOW} />);
    expect(screen.getByText("Closed it")).toBeTruthy();
    expect(screen.getByText("Briefed")).toBeTruthy();
    expect(screen.getByText(/seen 3d/)).toBeTruthy();
    expect(screen.getByText(/no extension/)).toBeTruthy();
    expect((screen.getByLabelText("Pick Grace Hopper") as HTMLInputElement).disabled).toBe(true);
  });

  it("searches by name or email", () => {
    render(<NudgePeople people={people} now={NOW} />);
    fireEvent.change(screen.getByLabelText("Search people"), { target: { value: "navy" } });
    expect(screen.queryByText("Ada Lovelace")).toBeNull();
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search people"), { target: { value: "zzz" } });
    expect(screen.getByText("No one")).toBeTruthy();
  });

  it("sends to the people picked, then marks them sent", async () => {
    fetchMock.mockReturnValue(Promise.resolve({ ok: true, json: async () => ({ ok: true, at: "2026-11-07T10:00:00Z" }) }));
    render(<NudgePeople people={people} now={NOW} />);
    const show = () => screen.getByRole("button", { name: /^Show/ }) as HTMLButtonElement;
    expect(show().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Pick Ada Lovelace"));
    fireEvent.click(screen.getByLabelText("Pick Alan Turing"));
    expect(show().textContent).toBe("Show to 2");
    fireEvent.click(show());
    await waitFor(() => expect(screen.getAllByText("Sent")).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/nudge/push", expect.objectContaining({ body: JSON.stringify({ userIds: ["user_a", "user_c"] }) }));
    expect(show().textContent).toBe("Show");
  });

  it("the top box picks everyone shown with an extension", () => {
    render(<NudgePeople people={people} now={NOW} />);
    fireEvent.click(screen.getByLabelText("Pick everyone shown"));
    expect(screen.getByRole("button", { name: /^Show/ }).textContent).toBe("Show to 2");
  });
});
