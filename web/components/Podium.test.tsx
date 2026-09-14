// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
    render(<Podium month={entries} all={entries} orgName="Acme" />);
    const steps = screen.getAllByRole("listitem").slice(0, 3);
    expect(within(steps[0]).getByText("jonas")).toBeTruthy();
    expect(within(steps[1]).getByText("razi")).toBeTruthy();
    expect(within(steps[2]).getByText("mira")).toBeTruthy();
  });

  it("shows the title each person earned", () => {
    render(<Podium month={entries} all={entries} orgName="Acme" />);
    expect(screen.getByText("chief bug officer")).toBeTruthy();
    expect(screen.getByText("the night shift")).toBeTruthy();
    expect(screen.getByText("still warming up")).toBeTruthy();
  });

  it("marks which one is you", () => {
    const { container } = render(
      <Podium month={entries} all={entries} orgName="Acme" />,
    );
    expect(container.textContent).toContain("you");
  });

  it("gives the leader something to say", () => {
    const { container } = render(
      <Podium month={entries} all={entries} orgName="Acme" />,
    );
    expect(container.textContent).toMatch(/[“"].+[”"]/);
  });

  it("lists everyone past third place below the podium", () => {
    render(<Podium month={entries} all={entries} orgName="Acme" />);
    expect(screen.getByText("tom")).toBeTruthy();
    expect(screen.getByText("ana")).toBeTruthy();
  });

  it("tells fourth place exactly how far off the podium they are", () => {
    render(<Podium month={entries} all={entries} orgName="Acme" />);
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
    render(<Podium month={close} all={close} orgName="Acme" />);
    expect(screen.getByText("bronze is 1 bug away.")).toBeTruthy();
  });

  it("drops the nudge when nobody is off the podium", () => {
    const { container } = render(
      <Podium month={entries.slice(0, 3)} all={entries.slice(0, 3)} orgName="Acme" />,
    );
    expect(container.textContent).not.toContain("bronze is");
  });

  it("renders a podium of two without an empty third step", () => {
    render(<Podium month={entries.slice(0, 2)} all={entries.slice(0, 2)} orgName="Acme" />);
    expect(screen.getByText("razi")).toBeTruthy();
    expect(screen.getByText("jonas")).toBeTruthy();
    expect(screen.queryByText("mira")).toBeNull();
  });

  it("gives a lone reporter their own card, not two empty steps", () => {
    const { container } = render(
      <Podium month={[entries[0]]} all={[entries[0]]} orgName="Acme" />,
    );
    expect(container.textContent).toContain("just you so far");
    expect(container.textContent).toContain("undisputed");
    // No rivals invented to fill the podium.
    expect(container.textContent).not.toContain("jonas");
    expect(container.textContent).not.toContain("bronze is");
  });

  it("tells a lone reporter what would turn it into a leaderboard", () => {
    const { container } = render(
      <Podium month={[entries[0]]} all={[entries[0]]} orgName="Acme" />,
    );
    expect(container.textContent).toContain(
      "when someone else at Acme files one, this turns into a leaderboard.",
    );
  });

  it("counts a lone reporter's tickets in the singular when there is one", () => {
    const solo = { ...entries[0], filed: 1 };
    const { container } = render(
      <Podium month={[solo]} all={[solo]} orgName="Acme" />,
    );
    expect(container.textContent).toContain("1 ticket");
    expect(container.textContent).not.toContain("1 tickets");
  });

  it("keeps a working range switch on the solo card", () => {
    const alone = [entries[0]];
    const crowd = [entries[0], entries[1]];
    const { container } = render(<Podium month={alone} all={crowd} orgName="Acme" />);

    expect(container.textContent).toContain("just you so far");
    fireEvent.click(screen.getByText("all time"));
    // Switching off the solo range turns it back into a real podium.
    expect(container.textContent).not.toContain("just you so far");
    expect(screen.getByText("jonas")).toBeTruthy();
  });

  it("swaps range in place, with no navigation", () => {
    const allTime = [
      entry("razi", 1, 99, { title: "chief bug officer", isYou: true }),
      entry("hedi", 2, 50, { title: "the closer" }),
    ];
    render(<Podium month={entries} all={allTime} orgName="Acme" />);

    expect(screen.getByText("past month").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("hedi")).toBeNull();

    fireEvent.click(screen.getByText("all time"));

    // The other range's data is already here - no fetch, no link.
    expect(screen.getByText("hedi")).toBeTruthy();
    expect(screen.getByText("all time").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("past month").getAttribute("href")).toBeNull();
  });

  it("does not leave an empty third step when only two people are ranked", () => {
    const two = entries.slice(0, 2);
    const { container } = render(<Podium month={two} all={two} orgName="Acme" />);
    // Three tracks with one empty cell shoved the pair off to the left.
    const ol = container.querySelector("ol")!;
    expect(ol.className).toContain("grid-cols-[repeat(2,minmax(0,1fr))]");
    expect(ol.querySelectorAll("li")).toHaveLength(2);
  });

  it("lists a teammate who filed nothing this range", () => {
    const withZero = [
      ...entries.slice(0, 3),
      entry("caroline", 4, 0, { title: "still warming up" }),
    ];
    render(<Podium month={withZero} all={withZero} orgName="Acme" />);
    expect(screen.getByText("caroline")).toBeTruthy();
  });

  it("names the org and counts the people in it", () => {
    const { container } = render(
      <Podium month={entries} all={entries} orgName="Acme" />,
    );
    expect(container.textContent).toContain("Acme");
    expect(container.textContent).toContain("5 people");
  });
});
