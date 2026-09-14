// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import Podium from "./Podium";
import type { PodiumEntry } from "@/lib/org-server";

afterEach(cleanup);

function entry(
  name: string,
  rank: number,
  filed: number,
  extra: Partial<PodiumEntry> = {},
): PodiumEntry {
  return { userId: name, rank, filed, name, isYou: false, ...extra };
}

const entries: PodiumEntry[] = [
  entry("razi", 1, 44, { title: "chief bug officer", isYou: true }),
  entry("jonas", 2, 31, { title: "the closer" }),
  entry("mira", 3, 18, { title: "the night shift" }),
  entry("tom", 4, 9, { title: "the novelist" }),
  entry("ana", 5, 4, { title: "still warming up" }),
];

describe("Podium", () => {
  it("stands first place in the middle, between second and third", () => {
    render(<Podium entries={entries} range="month" orgName="Acme" />);
    const steps = screen.getAllByRole("listitem").slice(0, 3);
    expect(within(steps[0]).getByText("jonas")).toBeTruthy();
    expect(within(steps[1]).getByText("razi")).toBeTruthy();
    expect(within(steps[2]).getByText("mira")).toBeTruthy();
  });

  it("shows the title each person earned", () => {
    render(<Podium entries={entries} range="month" orgName="Acme" />);
    expect(screen.getByText("chief bug officer")).toBeTruthy();
    expect(screen.getByText("the night shift")).toBeTruthy();
    expect(screen.getByText("still warming up")).toBeTruthy();
  });

  it("marks which one is you", () => {
    const { container } = render(
      <Podium entries={entries} range="month" orgName="Acme" />,
    );
    expect(container.textContent).toContain("you");
  });

  it("gives the leader something to say", () => {
    const { container } = render(
      <Podium entries={entries} range="month" orgName="Acme" />,
    );
    expect(container.textContent).toMatch(/[“"].+[”"]/);
  });

  it("lists everyone past third place below the podium", () => {
    render(<Podium entries={entries} range="month" orgName="Acme" />);
    expect(screen.getByText("tom")).toBeTruthy();
    expect(screen.getByText("ana")).toBeTruthy();
  });

  it("tells fourth place exactly how far off the podium they are", () => {
    render(<Podium entries={entries} range="month" orgName="Acme" />);
    // mira has 18, tom has 9 → 10 would overtake her.
    expect(screen.getByText("bronze is 10 bugs away.")).toBeTruthy();
  });

  it("says bug, not bugs, when one would do it", () => {
    const close = [
      entry("a", 1, 5),
      entry("b", 2, 4),
      entry("c", 3, 3),
      entry("d", 4, 3),
    ];
    render(<Podium entries={close} range="month" orgName="Acme" />);
    expect(screen.getByText("bronze is 1 bug away.")).toBeTruthy();
  });

  it("drops the nudge when nobody is off the podium", () => {
    const { container } = render(
      <Podium entries={entries.slice(0, 3)} range="month" orgName="Acme" />,
    );
    expect(container.textContent).not.toContain("bronze is");
  });

  it("renders a podium of two without an empty third step", () => {
    render(<Podium entries={entries.slice(0, 2)} range="month" orgName="Acme" />);
    expect(screen.getByText("razi")).toBeTruthy();
    expect(screen.getByText("jonas")).toBeTruthy();
    expect(screen.queryByText("mira")).toBeNull();
  });

  it("gives a lone reporter their own card, not two empty steps", () => {
    const { container } = render(
      <Podium entries={[entries[0]]} range="month" orgName="Acme" />,
    );
    expect(container.textContent).toContain("just you so far");
    expect(container.textContent).toContain("undisputed");
    // No rivals invented to fill the podium.
    expect(container.textContent).not.toContain("jonas");
    expect(container.textContent).not.toContain("bronze is");
  });

  it("tells a lone reporter what would turn it into a leaderboard", () => {
    const { container } = render(
      <Podium entries={[entries[0]]} range="month" orgName="Acme" />,
    );
    expect(container.textContent).toContain(
      "when someone else at Acme files one, this turns into a leaderboard.",
    );
  });

  it("counts a lone reporter's tickets in the singular when there is one", () => {
    const solo = { ...entries[0], filed: 1 };
    const { container } = render(
      <Podium entries={[solo]} range="month" orgName="Acme" />,
    );
    expect(container.textContent).toContain("1 ticket");
    expect(container.textContent).not.toContain("1 tickets");
  });

  it("keeps the range switch on the solo card", () => {
    render(<Podium entries={[entries[0]]} range="month" orgName="Acme" />);
    expect(screen.getByText("all time").getAttribute("href")).toBe(
      "/dashboard?top=all",
    );
  });

  it("marks the active range and links to the other one", () => {
    render(<Podium entries={entries} range="month" orgName="Acme" />);
    const month = screen.getByText("past month");
    const all = screen.getByText("all time");
    expect(month.getAttribute("aria-current")).toBe("true");
    expect(all.getAttribute("aria-current")).toBeNull();
    expect(all.getAttribute("href")).toBe("/dashboard?top=all");
    expect(month.getAttribute("href")).toBe("/dashboard");
  });

  it("names the org and counts the people in it", () => {
    const { container } = render(
      <Podium entries={entries} range="month" orgName="Acme" />,
    );
    expect(container.textContent).toContain("Acme");
    expect(container.textContent).toContain("5 people");
  });
});
