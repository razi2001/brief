import { describe, expect, it } from "vitest";
import {
  DURATIONS,
  MAX_BASH_NAME,
  board,
  cleanBashName,
  cleanWindow,
  clock,
  endOf,
  isBashCode,
  isDuration,
  isLive,
  leaders,
  lengthLabel,
  msLeft,
  personActive,
  personEnd,
  phaseOf,
  reportMarkdown,
} from "./bash";

const day = (d: number, hhmm = "10:00") => `2026-11-${String(d).padStart(2, "0")}T${hhmm}:00.000Z`;
const ms = (d: number, hhmm = "10:00") => new Date(day(d, hhmm)).getTime();
// Open from the 12th to the 15th.
const bash = { startsAt: day(12), endsAt: day(15), endedAt: null as string | null };

describe("names and codes", () => {
  it("cleans a name to one capped line", () => {
    expect(cleanBashName("  Release   2.4 \n")).toBe("Release 2.4");
    expect(cleanBashName("   ")).toBeNull();
    expect(cleanBashName(null)).toBeNull();
    expect(cleanBashName("x".repeat(200))).toHaveLength(MAX_BASH_NAME);
  });
  it("takes only a 12-character link code", () => {
    expect(isBashCode("aB3_-xYz0129")).toBe(true);
    expect(isBashCode("short")).toBe(false);
    expect(isBashCode("aB3_-xYz0129/")).toBe(false);
    expect(isBashCode(undefined)).toBe(false);
  });
});

describe("how long", () => {
  it("gives each person 15 minutes to 3 hours, never more", () => {
    expect(isDuration(45)).toBe(true);
    expect(isDuration(180)).toBe(true);
    expect(Math.max(...DURATIONS)).toBe(180);
    expect(isDuration(44)).toBe(false);
    expect(isDuration(300)).toBe(false);
    expect(isDuration("45")).toBe(false);
  });
  it("is upcoming before its start date, open between its dates, closed after", () => {
    expect(phaseOf(bash, ms(11))).toBe("upcoming");
    expect(phaseOf(bash, ms(12))).toBe("open");
    expect(phaseOf(bash, ms(14, "23:00"))).toBe("open");
    expect(phaseOf(bash, ms(15))).toBe("closed");
    expect(phaseOf({ ...bash, endedAt: day(13) }, ms(14))).toBe("closed");
  });
  it("names a length in minutes under the hour and in hours from there", () => {
    expect(DURATIONS.map(lengthLabel)).toEqual(["15 min", "30 min", "45 min", "1 h", "2 h", "3 h"]);
  });
});

describe("cleanWindow", () => {
  const now = ms(12, "09:00");
  it("takes a start and an end as asked", () => {
    expect(cleanWindow(day(14), day(17), now)).toEqual({ startsAt: day(14), endsAt: day(17) });
  });
  it("starts now when the start asked for is today, already past", () => {
    expect(cleanWindow(day(12, "00:00"), day(15), now)).toEqual({ startsAt: day(12, "09:00"), endsAt: day(15) });
  });
  it("refuses an end that is not after the start, or already past", () => {
    expect(cleanWindow(day(14), day(14), now)).toBeNull();
    expect(cleanWindow(day(14), day(13), now)).toBeNull();
    expect(cleanWindow(day(12, "00:00"), day(12, "08:00"), now)).toBeNull();
  });
  it("refuses a start more than a day back, or planned more than 90 days ahead", () => {
    expect(cleanWindow(day(10), day(15), now)).toBeNull();
    expect(cleanWindow("2027-06-01T10:00:00.000Z", "2027-06-03T10:00:00.000Z", now)).toBeNull();
  });
  it("refuses one open for more than 31 days", () => {
    expect(cleanWindow(day(13), "2026-12-13T10:00:00.000Z", now)).toEqual({ startsAt: day(13), endsAt: "2026-12-13T10:00:00.000Z" });
    expect(cleanWindow(day(13), "2026-12-15T10:00:00.000Z", now)).toBeNull();
  });
  it("refuses what is not a date", () => {
    expect(cleanWindow("soon", day(15), now)).toBeNull();
    expect(cleanWindow(day(13), 5, now)).toBeNull();
    expect(cleanWindow(undefined, undefined, now)).toBeNull();
  });
});

describe("the quality competition's own window", () => {
  it("is open until it is due to close", () => {
    expect(isLive(bash, ms(14))).toBe(true);
    expect(isLive(bash, ms(15))).toBe(false);
    expect(msLeft(bash, ms(14))).toBe(24 * 3600_000);
    expect(msLeft(bash, ms(20))).toBe(0);
  });
  it("closes at the early close when there is one", () => {
    const early = { ...bash, endedAt: day(13) };
    expect(endOf(early)).toBe(ms(13));
    expect(isLive(early, ms(14))).toBe(false);
  });
});

describe("each person's own clock", () => {
  it("runs for their minutes from the moment they start", () => {
    expect(personEnd(bash, day(13, "09:00"), 180)).toBe(ms(13, "12:00"));
    expect(personActive(bash, day(13, "09:00"), 180, ms(13, "11:59"))).toBe(true);
    expect(personActive(bash, day(13, "09:00"), 180, ms(13, "12:00"))).toBe(false);
  });
  it("does not depend on when anyone else started", () => {
    // One person on the 12th, another on the 14th: each gets a full hour.
    expect(personEnd(bash, day(12, "10:00"), 60)).toBe(ms(12, "11:00"));
    expect(personEnd(bash, day(14, "16:00"), 60)).toBe(ms(14, "17:00"));
  });
  it("stops when the quality competition closes, even with time left", () => {
    expect(personEnd(bash, day(15, "09:30"), 180)).toBe(ms(15, "10:00"));
    const early = { ...bash, endedAt: day(13, "09:20") };
    expect(personEnd(early, day(13, "09:00"), 180)).toBe(ms(13, "09:20"));
    expect(personActive(early, day(13, "09:00"), 180, ms(13, "09:30"))).toBe(false);
  });
});

describe("clock", () => {
  it("reads as m:ss, and h:mm:ss past the hour", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(65_000)).toBe("1:05");
    expect(clock(59_001)).toBe("1:00");
    expect(clock(3 * 3600_000)).toBe("3:00:00");
  });
  it("reads as days and hours past a day", () => {
    expect(clock(24 * 3600_000)).toBe("1d");
    expect(clock((2 * 24 + 4) * 3600_000 + 5000)).toBe("2d 4h");
  });
});

describe("board", () => {
  const members = [
    { userId: "ana", joinedAt: day(12, "10:00") },
    { userId: "ben", joinedAt: day(12, "10:01") },
    { userId: "cy", joinedAt: day(14, "10:02") },
  ];
  const brief = (userId: string, hhmm: string) => ({ id: `${userId}${hhmm}`, userId, createdAt: day(12, hhmm) });

  it("lists everyone who started, most briefs first, with zeros", () => {
    const rows = board(members, [brief("ben", "10:05"), brief("ben", "10:06"), brief("ana", "10:07")]);
    expect(rows).toEqual([
      { userId: "ben", count: 2, rank: 1 },
      { userId: "ana", count: 1, rank: 2 },
      { userId: "cy", count: 0, rank: 3 },
    ]);
  });
  it("shares a rank on a tie, listing whoever got there first", () => {
    const rows = board(members, [brief("ana", "10:10"), brief("ben", "10:05"), brief("cy", "10:20")]);
    expect(rows.map((r) => [r.userId, r.rank])).toEqual([
      ["ben", 1],
      ["ana", 1],
      ["cy", 1],
    ]);
  });
  it("orders people with nothing by when they started", () => {
    expect(board(members, []).map((r) => r.userId)).toEqual(["ana", "ben", "cy"]);
  });

  describe("leaders, for the line on the list", () => {
    const four = [...members, { userId: "dee", joinedAt: day(14, "10:03") }];
    it("gives the first three who found something, and your place", () => {
      const got = leaders(four, [brief("ben", "10:05"), brief("ben", "10:06"), brief("ana", "10:07"), brief("cy", "10:08"), brief("dee", "10:09")], "dee");
      expect(got.top.map((r) => [r.userId, r.rank])).toEqual([
        ["ben", 1],
        ["ana", 2],
        ["cy", 2],
      ]);
      expect(got.yourRank).toBe(2);
    });
    it("leaves out anyone with nothing yet, you included", () => {
      const got = leaders(members, [brief("ana", "10:07")], "ben");
      expect(got.top.map((r) => r.userId)).toEqual(["ana"]);
      expect(got.yourRank).toBeNull();
    });
    it("is empty before anyone found anything", () => {
      expect(leaders(members, [], "ana")).toEqual({ top: [], yourRank: null });
    });
  });
});

describe("reportMarkdown", () => {
  it("writes the totals, the board and each bug", () => {
    const md = reportMarkdown({
      name: "Release 2.4",
      minutes: 180,
      people: [
        { name: "Ana", count: 2 },
        { name: "Ben", count: 0 },
      ],
      briefs: [
        { title: "Pay button does nothing", by: "Ana", url: "https://x/b/abc", ticket: "APP-12" },
        { title: "Typo on sign-in", by: "Ana" },
      ],
    });
    expect(md).toBe(
      [
        "# Release 2.4",
        "",
        "2 bugs found by 2 people, with up to 3 h each.",
        "",
        "## Board",
        "",
        "1. Ana: 2",
        "2. Ben: 0",
        "",
        "## Bugs",
        "",
        "- [APP-12 Pay button does nothing](https://x/b/abc) (Ana)",
        "- Typo on sign-in (Ana)",
        "",
      ].join("\n"),
    );
  });
  it("says one bug and one person in the singular, with no Bugs section when empty", () => {
    const one = reportMarkdown({ name: "N", minutes: 45, people: [{ name: "Ana", count: 1 }], briefs: [{ title: "T", by: "Ana" }] });
    expect(one).toContain("1 bug found by 1 person, with up to 45 min each.");
    const none = reportMarkdown({ name: "N", minutes: 45, people: [{ name: "Ana", count: 0 }], briefs: [] });
    expect(none).not.toContain("## Bugs");
  });
});
