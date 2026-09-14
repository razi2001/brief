import { describe, it, expect } from "vitest";
import { rankReporters, showPodium, type LeaderRow } from "./podium";

/** A row with every signal at zero, so each test varies only what it cares about. */
function row(userId: string, filed: number, extra: Partial<LeaderRow> = {}): LeaderRow {
  return { userId, filed, night: 0, avgTitle: 0, prevFiled: 0, ...extra };
}

describe("rankReporters", () => {
  it("ranks by tickets filed, descending", () => {
    const out = rankReporters([row("a", 4), row("b", 44), row("c", 18)]);
    expect(out.map((r) => r.userId)).toEqual(["b", "c", "a"]);
    expect(out.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("excludes people who filed nothing in the range", () => {
    const out = rankReporters([row("a", 3), row("b", 0)]);
    expect(out.map((r) => r.userId)).toEqual(["a"]);
  });

  it("breaks ties by user id so the order is stable between renders", () => {
    const out = rankReporters([row("zed", 5), row("amy", 5)]);
    expect(out.map((r) => r.userId)).toEqual(["amy", "zed"]);
    expect(out.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("crowns the leader chief bug officer", () => {
    const out = rankReporters([row("a", 10), row("b", 2)]);
    expect(out[0].title).toBe("chief bug officer");
  });

  it("names the runner-up the closer", () => {
    const out = rankReporters([row("a", 10), row("b", 2)]);
    expect(out[1].title).toBe("the closer");
  });

  it("gives the night shift to whoever files most after hours", () => {
    const out = rankReporters([
      row("a", 10),
      row("b", 8),
      row("c", 6, { night: 5 }),
      row("d", 4, { night: 1 }),
    ]);
    expect(out.find((r) => r.userId === "c")?.title).toBe("the night shift");
  });

  it("does not award the night shift when nobody files at night", () => {
    const out = rankReporters([row("a", 10), row("b", 8), row("c", 6)]);
    expect(out.map((r) => r.title)).not.toContain("the night shift");
  });

  it("gives the novelist to the longest average title", () => {
    const out = rankReporters([
      row("a", 10),
      row("b", 8),
      row("c", 6, { avgTitle: 120 }),
      row("d", 4, { avgTitle: 20 }),
    ]);
    expect(out.find((r) => r.userId === "c")?.title).toBe("the novelist");
  });

  it("gives on a tear to the biggest jump over the previous window", () => {
    const out = rankReporters([
      row("a", 10),
      row("b", 8),
      row("c", 6, { prevFiled: 1 }),
      row("d", 5, { prevFiled: 5 }),
    ]);
    expect(out.find((r) => r.userId === "c")?.title).toBe("on a tear");
  });

  it("does not award on a tear to someone who got slower", () => {
    const out = rankReporters([row("a", 10), row("b", 8), row("c", 2, { prevFiled: 9 })]);
    expect(out.map((r) => r.title)).not.toContain("on a tear");
  });

  it("gives the last-placed reporter a gentle title, never a cruel one", () => {
    const out = rankReporters([row("a", 10), row("b", 8), row("c", 6), row("d", 1)]);
    expect(out[3].title).toBe("still warming up");
  });

  it("never assigns the same title to two people", () => {
    const out = rankReporters([
      row("a", 10, { night: 9, avgTitle: 200, prevFiled: 0 }),
      row("b", 8, { night: 8, avgTitle: 190, prevFiled: 0 }),
      row("c", 6, { night: 7, avgTitle: 180, prevFiled: 1 }),
      row("d", 4, { night: 6, avgTitle: 170, prevFiled: 1 }),
      row("e", 2, { night: 5, avgTitle: 160, prevFiled: 1 }),
    ]);
    const titles = out.map((r) => r.title).filter(Boolean);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("gives each person at most one title", () => {
    const out = rankReporters([
      row("a", 10, { night: 9, avgTitle: 200 }),
      row("b", 8),
      row("c", 6),
    ]);
    expect(out[0].title).toBe("chief bug officer");
  });

  it("handles an empty org", () => {
    expect(rankReporters([])).toEqual([]);
  });
});

describe("showPodium", () => {
  it("shows a lone reporter their own standing", () => {
    // Hiding it would mean the first person in a workspace never discovers the
    // feature exists - they'd file for weeks and see nothing.
    expect(showPodium(rankReporters([row("a", 10)]))).toBe(true);
  });

  it("hides a podium with nobody on it", () => {
    expect(showPodium([])).toBe(false);
  });

  it("hides it when the only member has filed nothing in the range", () => {
    expect(showPodium(rankReporters([row("a", 0)]))).toBe(false);
  });

  it("shows the podium once two people have filed", () => {
    expect(showPodium(rankReporters([row("a", 10), row("b", 1)]))).toBe(true);
  });
});
