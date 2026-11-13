import { describe, expect, it } from "vitest";
import {
  MAX_GROUP_TITLE,
  cleanGroupTitle,
  groupingInput,
  labelInstruction,
  mergedDescription,
  normalizeGroups,
  pickPrimary,
  singles,
  type ReviewReport,
} from "./bash-review";

const report = (id: string, title: string, body = "", createdAt = "2026-11-12T10:00:00Z"): ReviewReport => ({
  id,
  title,
  body,
  userId: "u",
  createdAt,
});
const reports = [
  report("a", "Pay button does nothing"),
  report("b", "Typo on sign-in"),
  report("c", "Checkout button unresponsive after declined card"),
  report("d", "Avatar menu stays open"),
];

describe("cleanGroupTitle", () => {
  it("keeps one capped line", () => {
    expect(cleanGroupTitle("  Pay   button\n broken ")).toBe("Pay button broken");
    expect(cleanGroupTitle("x".repeat(500))).toHaveLength(MAX_GROUP_TITLE);
  });
  it("is null for blanks and non-strings", () => {
    expect(cleanGroupTitle("  ")).toBeNull();
    expect(cleanGroupTitle(3)).toBeNull();
  });
});

describe("groupingInput", () => {
  it("numbers the reports from 1, with the start of each body on one line", () => {
    const text = groupingInput([report("a", "Pay  fails", "**Summary**\n\nNothing   happens."), report("b", "")]);
    expect(text).toBe("[1] Pay fails\n**Summary** Nothing happens.\n\n[2] Untitled");
  });
  it("cuts a long body", () => {
    const text = groupingInput([report("a", "T", "y".repeat(5000))]);
    expect(text.length).toBeLessThan(700);
  });
});

describe("normalizeGroups", () => {
  it("turns the model's numbers into report ids, biggest group first", () => {
    const got = normalizeGroups(reports, {
      groups: [
        { title: "Sign-in typo", reports: [2] },
        { title: "Pay button does nothing after a declined card", reports: [3, 1] },
        { title: "Avatar menu stays open", reports: [4] },
      ],
    });
    expect(got).toEqual([
      { title: "Pay button does nothing after a declined card", ids: ["a", "c"] },
      { title: "Sign-in typo", ids: ["b"] },
      { title: "Avatar menu stays open", ids: ["d"] },
    ]);
  });

  it("gives a report the model forgot a group of its own", () => {
    const got = normalizeGroups(reports, { groups: [{ title: "Pay", reports: [1, 3] }] });
    expect(got.map((g) => g.ids)).toEqual([["a", "c"], ["b"], ["d"]]);
    expect(got[1].title).toBe("Typo on sign-in");
  });

  it("counts a repeated number once, the first time", () => {
    const got = normalizeGroups(reports, {
      groups: [
        { title: "One", reports: [1, 1, 2] },
        { title: "Two", reports: [2, 3] },
      ],
    });
    expect(got.find((g) => g.title === "One")?.ids).toEqual(["a", "b"]);
    expect(got.find((g) => g.title === "Two")?.ids).toEqual(["c"]);
  });

  it("ignores numbers that are not reports and drops groups left empty", () => {
    const got = normalizeGroups(reports, {
      groups: [
        { title: "Ghost", reports: [0, 9, -1, 2.5, "3"] },
        { title: "Real", reports: [4] },
      ],
    });
    expect(got.some((g) => g.title === "Ghost")).toBe(false);
    expect(got.flatMap((g) => g.ids).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("uses the first report's title when the model gives none", () => {
    const got = normalizeGroups(reports, { groups: [{ title: "  ", reports: [3, 1] }] });
    expect(got[0]).toEqual({ title: "Pay button does nothing", ids: ["a", "c"] });
  });

  it("falls back to every report alone on a useless answer", () => {
    for (const raw of [null, undefined, {}, { groups: "nope" }, { groups: [null] }] as never[]) {
      expect(normalizeGroups(reports, raw)).toEqual(singles(reports));
    }
  });

  it("puts every report in exactly one group whatever comes back", () => {
    const got = normalizeGroups(reports, {
      groups: [
        { title: "A", reports: [4, 4, 1] },
        { title: "B", reports: [1, 2, 7] },
      ],
    });
    expect(got.flatMap((g) => g.ids).sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("pickPrimary", () => {
  it("takes the report with the most written up", () => {
    const got = pickPrimary([report("a", "A", "short"), report("b", "B", "a much longer write-up"), report("c", "C")]);
    expect(got?.id).toBe("b");
  });
  it("takes the first one made on a tie", () => {
    const got = pickPrimary([report("a", "A", "same", "2026-11-12T10:05:00Z"), report("b", "B", "same", "2026-11-12T10:01:00Z")]);
    expect(got?.id).toBe("b");
  });
  it("is undefined for no reports", () => {
    expect(pickPrimary([])).toBeUndefined();
  });
});

describe("mergedDescription", () => {
  it("adds where it was found and every report, with links", () => {
    const md = mergedDescription("**Summary**\n\nPay does nothing.\n", "Release 2.4 bug bash", [
      { name: "Ana", title: "Pay button does nothing", url: "https://x/b/aaa" },
      { name: "Ben", title: "Checkout  button\nunresponsive", url: "https://x/b/bbb" },
      { name: "Ana", title: "Pay again" },
    ]);
    expect(md).toBe(
      [
        "**Summary**\n\nPay does nothing.",
        "**Bug bash**\n\nFound in Release 2.4 bug bash. Reported 3 times, by 2 people.",
        "**Reports**\n\n- Ana: [Pay button does nothing](https://x/b/aaa)\n- Ben: [Checkout button unresponsive](https://x/b/bbb)\n- Ana: Pay again",
      ].join("\n\n"),
    );
  });
  it("names the one reporter of a lone report", () => {
    const md = mergedDescription("Body", "Bash", [{ name: "Ana", title: "T" }]);
    expect(md).toContain("Found in Bash. Reported by Ana.");
  });
  it("still lists the reports when nothing was written up", () => {
    expect(mergedDescription("  ", "Bash", [{ name: "Ana", title: "T" }]).startsWith("**Bug bash**")).toBe(true);
  });
});

describe("labelInstruction", () => {
  it("names the label exactly", () => {
    expect(labelInstruction("Release 2.4")).toContain('Put the label "Release 2.4" on it');
  });
});
