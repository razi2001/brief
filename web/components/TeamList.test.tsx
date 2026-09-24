// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import TeamList from "./TeamList";
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
    render(<TeamList members={TEAM} orgName="Acme" providerName="Linear" />);
    expect(screen.getByText("Acme on Linear · 3 people")).toBeTruthy();
  });

  it("lists everyone in the order given, marking you", () => {
    render(<TeamList members={TEAM} orgName="Acme" providerName="Linear" />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Razi Fezzani");
    expect(rows[0].textContent).toContain("you");
    expect(rows[1].textContent).toContain("Ana Costa");
    expect(rows[1].textContent).not.toContain("you");
  });

  it("shows each person's title and tickets", () => {
    render(<TeamList members={TEAM} orgName="Acme" providerName="Linear" />);
    expect(screen.getByText("the closer")).toBeTruthy();
    expect(screen.getByText("44 tickets")).toBeTruthy();
  });

  it("counts one ticket in the singular", () => {
    render(<TeamList members={TEAM} orgName="Acme" providerName="Linear" />);
    expect(screen.getByText("1 ticket")).toBeTruthy();
    expect(screen.queryByText("1 tickets")).toBeNull();
  });

  it("uses the initials of a full name when there is no picture", () => {
    render(<TeamList members={TEAM} orgName="Acme" providerName="Linear" />);
    expect(screen.getByText("RF")).toBeTruthy();
  });

  it("says so when you are the only one", () => {
    render(<TeamList members={[TEAM[0]]} orgName="Acme" providerName="Linear" />);
    expect(screen.getByText("Acme on Linear · just you so far")).toBeTruthy();
  });

  it("renders nothing without a team", () => {
    const { container } = render(<TeamList members={[]} orgName="Acme" providerName="Linear" />);
    expect(container.innerHTML).toBe("");
  });
});
