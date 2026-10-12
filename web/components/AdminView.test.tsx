// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminView from "./AdminView";
import { DEFAULT_FILTERS, NO_ORG, type AdminRow } from "@/lib/admin-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  window.history.replaceState(null, "", "/admin");
});
afterEach(cleanup);

const row = (over: Partial<AdminRow>): AdminRow => ({
  id: "id",
  kind: "ticket",
  status: "filed",
  title: "A ticket",
  createdAt: "2026-10-01T10:00:00Z",
  deleted: false,
  shareId: null,
  ticketUrl: null,
  ticketIdentifier: null,
  provider: null,
  stateName: null,
  stateColor: null,
  userId: "u1",
  personName: "Razi Fezzani",
  personEmail: "fezzani.razi@gmail.com",
  personImage: null,
  orgKey: "linear:thunders",
  orgName: "Thunders",
  ...over,
});

const rows = [
  row({ id: "1", title: "Checkout fails", shareId: "s1", ticketIdentifier: "RAZ-12", ticketUrl: "https://linear.app/x/issue/RAZ-12", provider: "linear", stateName: "In Progress", stateColor: "#f2c94c" }),
  row({ id: "2", title: "Login loops", kind: "draft", status: "drafted", shareId: "s2" }),
  row({ id: "3", title: "Invoice blank", shareId: "s3", userId: "u2", personName: "Alice", personEmail: "alice@acme.io", orgKey: "jira:acme", orgName: "Acme" }),
  row({ id: "4", title: "Old ticket", userId: "u3", personName: "Bob", personEmail: null, orgKey: NO_ORG, orgName: "No org" }),
  row({ id: "5", title: "Removed one", shareId: "s5", deleted: true }),
];

const titles = () => screen.queryAllByRole("listitem").map((li) => li.querySelector("a,span")?.textContent);

describe("AdminView", () => {
  it("lists every live ticket and draft with its share link", () => {
    render(<AdminView rows={rows} initial={DEFAULT_FILTERS} />);
    expect(titles()).toEqual(["Checkout fails", "Login loops", "Invoice blank", "Old ticket"]);
    expect(screen.getByText("/b/s1")).toBeTruthy();
    expect(screen.getByText("No share link")).toBeTruthy();
    expect(screen.getByText("RAZ-12").closest("a")?.getAttribute("href")).toBe("https://linear.app/x/issue/RAZ-12");
    expect(screen.getByText("Checkout fails").getAttribute("href")).toBe("/b/s1");
    // A ticket without a share link opens its tracker page instead (here: none).
    expect(screen.getByText("Old ticket").tagName).toBe("SPAN");
  });

  it("filters by organization, then person, and keeps the URL in step", async () => {
    render(<AdminView rows={rows} initial={DEFAULT_FILTERS} />);
    fireEvent.change(screen.getByLabelText("Organization"), { target: { value: "linear:thunders" } });
    expect(titles()).toEqual(["Checkout fails", "Login loops"]);
    // The person list narrows to that org.
    const people = [...(screen.getByLabelText("Person") as HTMLSelectElement).options].map((o) => o.textContent);
    expect(people).toEqual(["Everyone", "Razi Fezzani (2)"]);
    fireEvent.click(screen.getByRole("tab", { name: /Drafts/ }));
    expect(titles()).toEqual(["Login loops"]);
    await waitFor(() => expect(window.location.search).toBe("?kind=draft&org=linear%3Athunders"));
  });

  it("drops the person when the picked org doesn't have them", () => {
    render(<AdminView rows={rows} initial={{ ...DEFAULT_FILTERS, person: "u2" }} />);
    expect(titles()).toEqual(["Invoice blank"]);
    fireEvent.change(screen.getByLabelText("Organization"), { target: { value: "linear:thunders" } });
    expect((screen.getByLabelText("Person") as HTMLSelectElement).value).toBe("");
    expect(titles()).toEqual(["Checkout fails", "Login loops"]);
  });

  it("shows deleted rows only when asked", () => {
    render(<AdminView rows={rows} initial={DEFAULT_FILTERS} />);
    expect(screen.queryByText("Removed one")).toBeNull();
    fireEvent.click(screen.getByLabelText("Include deleted"));
    expect(screen.getByText("Removed one")).toBeTruthy();
    expect(screen.getByText("Deleted")).toBeTruthy();
  });

  it("copies one link, or every shown link one per line", async () => {
    render(<AdminView rows={rows} initial={DEFAULT_FILTERS} />);
    fireEvent.click(screen.getByText("/b/s3"));
    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/b/s3`);
    fireEvent.click(screen.getByText("Copy 3 links"));
    expect(writeText).toHaveBeenLastCalledWith(
      ["s1", "s2", "s3"].map((s) => `${window.location.origin}/b/${s}`).join("\n"),
    );
    await waitFor(() => expect(screen.getAllByText("Copied").length).toBeGreaterThan(0));
  });

  it("searches across title, person and email", () => {
    render(<AdminView rows={rows} initial={DEFAULT_FILTERS} />);
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "acme.io" } });
    expect(titles()).toEqual(["Invoice blank"]);
    fireEvent.click(screen.getByText("Clear"));
    expect(titles()).toHaveLength(4);
  });
});
