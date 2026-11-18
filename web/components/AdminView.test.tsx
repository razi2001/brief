// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminView from "./AdminView";
import { DEFAULT_FILTERS, NO_ORG, type AdminRow } from "@/lib/admin-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

beforeEach(() => {
  window.history.replaceState(null, "", "/admin");
});
afterEach(cleanup);

const row = (over: Partial<AdminRow>): AdminRow => ({
  id: "id",
  kind: "ticket",
  status: "filed",
  createdAt: "2026-10-01T10:00:00Z",
  deleted: false,
  provider: "linear",
  userId: "u1",
  personName: "Sam Rivera",
  personEmail: "sam@example.com",
  personImage: null,
  orgKey: "linear:acme",
  orgName: "Acme",
  ...over,
});

const rows = [
  row({ id: "1" }),
  row({ id: "2", kind: "draft", status: "drafted" }),
  row({ id: "3", userId: "u2", personName: "Alice", personEmail: "alice@globex.io", orgKey: "jira:globex", orgName: "Globex", provider: "jira" }),
  row({ id: "4", userId: "u3", personName: "Bob", personEmail: null, orgKey: NO_ORG, orgName: "No org", status: "failed" }),
  row({ id: "5", userId: "u4", personName: "Gone", deleted: true }),
];

const names = () =>
  screen.queryAllByRole("listitem").map((li) => li.querySelector(".text-ink-2")?.textContent);

describe("AdminView", () => {
  it("lists who made what, with no title, text or link", () => {
    const { container } = render(<AdminView rows={rows} initial={DEFAULT_FILTERS} />);
    expect(names()).toEqual(["Sam Rivera", "Sam Rivera", "Alice", "Bob"]);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.innerHTML).not.toContain("/b/");
    expect(screen.getAllByText("Didn't file").length).toBeGreaterThan(0);
  });

  it("filters by organization, then person, and keeps the URL in step", async () => {
    render(<AdminView rows={rows} initial={DEFAULT_FILTERS} />);
    fireEvent.change(screen.getByLabelText("Organization"), { target: { value: "linear:acme" } });
    expect(names()).toEqual(["Sam Rivera", "Sam Rivera"]);
    const people = [...(screen.getByLabelText("Person") as HTMLSelectElement).options].map((o) => o.textContent);
    expect(people).toEqual(["Everyone", "Sam Rivera (2)"]);
    fireEvent.click(screen.getByRole("tab", { name: /Drafts/ }));
    expect(names()).toEqual(["Sam Rivera"]);
    await waitFor(() => expect(window.location.search).toBe("?kind=draft&org=linear%3Aacme"));
  });

  it("drops the person when the picked org doesn't have them", () => {
    render(<AdminView rows={rows} initial={{ ...DEFAULT_FILTERS, person: "u2" }} />);
    expect(names()).toEqual(["Alice"]);
    fireEvent.change(screen.getByLabelText("Organization"), { target: { value: "linear:acme" } });
    expect((screen.getByLabelText("Person") as HTMLSelectElement).value).toBe("");
    expect(names()).toEqual(["Sam Rivera", "Sam Rivera"]);
  });

  it("shows deleted rows only when asked", () => {
    render(<AdminView rows={rows} initial={DEFAULT_FILTERS} />);
    expect(screen.queryByText("Gone")).toBeNull();
    fireEvent.click(screen.getByLabelText("Include deleted"));
    expect(screen.getByText("Gone")).toBeTruthy();
    expect(screen.getByText("Deleted")).toBeTruthy();
  });

  it("searches across person, email and org", () => {
    render(<AdminView rows={rows} initial={DEFAULT_FILTERS} />);
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "globex.io" } });
    expect(names()).toEqual(["Alice"]);
    fireEvent.click(screen.getByText("Clear"));
    expect(names()).toHaveLength(4);
  });
});
