import { describe, expect, it } from "vitest";
import {
  MAX_BRIEFS_PER_CHANGE,
  MAX_TAG_NAME,
  UNTAGGED,
  allTagged,
  applyTagChange,
  changeDelta,
  cleanBriefIds,
  cleanTagName,
  isTagColor,
  nextTagColor,
  parseTagParam,
} from "./tags";

const A = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const B = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("cleanTagName", () => {
  it("keeps one line with single spaces", () => {
    expect(cleanTagName("  Check   out\n flow ")).toBe("Check out flow");
  });
  it("is null for nothing, blanks and non-strings", () => {
    expect(cleanTagName("")).toBeNull();
    expect(cleanTagName("   ")).toBeNull();
    expect(cleanTagName(12)).toBeNull();
    expect(cleanTagName(undefined)).toBeNull();
  });
  it("caps the length and leaves no trailing space", () => {
    const name = cleanTagName("a".repeat(MAX_TAG_NAME - 1) + " bcd");
    expect(name).toBe("a".repeat(MAX_TAG_NAME - 1));
  });
});

describe("isTagColor", () => {
  it("takes only the listed colours", () => {
    expect(isTagColor("sage")).toBe(true);
    expect(isTagColor("red")).toBe(false);
    // An inherited property name is not a colour.
    expect(isTagColor("toString")).toBe(false);
    expect(isTagColor(null)).toBe(false);
  });
});

describe("nextTagColor", () => {
  it("starts with the first colour", () => {
    expect(nextTagColor([])).toBe("clay");
  });
  it("picks the least used one", () => {
    expect(nextTagColor([{ color: "clay" }])).toBe("ochre");
    expect(nextTagColor([{ color: "clay" }, { color: "ochre" }, { color: "sage" }, { color: "denim" }, { color: "plum" }])).toBe("berry");
  });
  it("goes round again once all are used", () => {
    const all = ["clay", "ochre", "sage", "denim", "plum", "berry"].map((color) => ({ color }));
    expect(nextTagColor(all)).toBe("clay");
    expect(nextTagColor([...all, { color: "clay" }])).toBe("ochre");
  });
});

describe("cleanBriefIds", () => {
  it("keeps distinct uuids and drops the rest", () => {
    expect(cleanBriefIds([A, A, "nope", 3, B])).toEqual([A, B]);
    expect(cleanBriefIds("x")).toEqual([]);
  });
  it("caps how many one request may name", () => {
    const many = Array.from({ length: MAX_BRIEFS_PER_CHANGE + 20 }, (_, i) => `${String(i).padStart(8, "0")}-5d4a-4e6f-9a7b-1c2d3e4f5a6b`);
    expect(cleanBriefIds(many)).toHaveLength(MAX_BRIEFS_PER_CHANGE);
  });
});

describe("applyTagChange / changeDelta / allTagged", () => {
  const before = { b1: ["t1"], b2: [] as string[] };

  it("adds a tag once, and counts only the briefs that gained it", () => {
    const next = applyTagChange(before, ["b1", "b2", "b3"], "t1", true);
    expect(next).toEqual({ b1: ["t1"], b2: ["t1"], b3: ["t1"] });
    expect(changeDelta(before, ["b1", "b2", "b3"], "t1", true)).toBe(2);
    // The input is not changed.
    expect(before).toEqual({ b1: ["t1"], b2: [] });
  });

  it("removes a tag, and counts only the briefs that had it", () => {
    expect(applyTagChange(before, ["b1", "b2"], "t1", false)).toEqual({ b1: [], b2: [] });
    expect(changeDelta(before, ["b1", "b2"], "t1", false)).toBe(-1);
  });

  it("allTagged is true only when every brief carries it", () => {
    expect(allTagged(before, ["b1"], "t1")).toBe(true);
    expect(allTagged(before, ["b1", "b2"], "t1")).toBe(false);
    expect(allTagged(before, [], "t1")).toBe(false);
  });
});

describe("parseTagParam", () => {
  it("takes a tag id or the untagged folder", () => {
    expect(parseTagParam(A)).toBe(A);
    expect(parseTagParam(UNTAGGED)).toBe(UNTAGGED);
  });
  it("is null for anything else", () => {
    expect(parseTagParam(undefined)).toBeNull();
    expect(parseTagParam("all")).toBeNull();
    expect(parseTagParam([A])).toBeNull();
    expect(parseTagParam(`${A}) or 1=1`)).toBeNull();
  });
});
