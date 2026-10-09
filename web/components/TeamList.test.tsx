// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import TeamList, { teamSummary } from "./TeamList";
import type { TeamMember } from "@/lib/team";

afterEach(cleanup);

const m = (userId: string, fullName: string, extra: Partial<TeamMember> = {}): TeamMember => ({
  userId,
  fullName,
  isYou: false,
  filed: 0,
  ...extra,
});

const TEAM = [
  m("u1", "Razi Fezzani", { isYou: true, filed: 44, title: "chief bug officer" }),
  m("u2", "Ana Costa", { filed: 1, title: "still warming up" }),
  m("u3", "Jonas Weber", { filed: 31, title: "the closer" }),
];

describe("TeamList", () => {
  it("names the org, its tracker and its size", () => {
    expect(teamSummary("Acme", "Linear", 3)).toBe("Acme on Linear · 3 people");
  });

  it("lists everyone in the order given, marking you", () => {
    render(<TeamList members={TEAM} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Razi Fezzani");
    expect(rows[0].textContent).toContain("you");
    expect(rows[1].textContent).toContain("Ana Costa");
    expect(rows[1].textContent).not.toContain("you");
  });

  it("shows each person's title and tickets", () => {
    render(<TeamList members={TEAM} />);
    expect(screen.getByText("the closer")).toBeTruthy();
    expect(screen.getByText("44 tickets")).toBeTruthy();
  });

  it("counts one ticket in the singular", () => {
    render(<TeamList members={TEAM} />);
    expect(screen.getByText("1 ticket")).toBeTruthy();
    expect(screen.queryByText("1 tickets")).toBeNull();
  });

  it("uses the initials of a full name when there is no picture", () => {
    render(<TeamList members={TEAM} />);
    expect(screen.getByText("RF")).toBeTruthy();
  });

  it("says so when you are the only one", () => {
    expect(teamSummary("Acme", "Linear", 1)).toBe("Acme on Linear · just you so far");
  });

  it("renders nothing without a team", () => {
    const { container } = render(<TeamList members={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
