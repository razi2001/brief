import { describe, expect, it } from "vitest";
import { GROUPS, LESSONS, lessonBySlug, neighbours } from "./lessons";

describe("guide lessons", () => {
  it("has one lesson per feature, each slug once", () => {
    expect(LESSONS).toHaveLength(8);
    expect(new Set(LESSONS.map((l) => l.slug)).size).toBe(LESSONS.length);
  });

  it("puts every lesson in a known group, groups in order", () => {
    const keys = GROUPS.map((g) => g.key);
    for (const l of LESSONS) expect(keys).toContain(l.group);
    // lessons of a group sit together, in the groups' order
    const order = LESSONS.map((l) => keys.indexOf(l.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("finds a lesson by slug, and nothing for an unknown one", () => {
    expect(lessonBySlug("record")?.title).toBeTruthy();
    expect(lessonBySlug("nope")).toBeUndefined();
  });

  it("chains previous and next in reading order", () => {
    const first = LESSONS[0].slug;
    const last = LESSONS[LESSONS.length - 1].slug;
    expect(neighbours(first).prev).toBeUndefined();
    expect(neighbours(first).next?.slug).toBe(LESSONS[1].slug);
    expect(neighbours(last).next).toBeUndefined();
    expect(neighbours(last).prev?.slug).toBe(LESSONS[LESSONS.length - 2].slug);
  });

  it("keeps lessons short: 3 to 5 steps", () => {
    for (const l of LESSONS) {
      expect(l.steps.length, l.slug).toBeGreaterThanOrEqual(3);
      expect(l.steps.length, l.slug).toBeLessThanOrEqual(5);
    }
  });

  it("never uses an em or en dash (brand voice)", () => {
    const text = LESSONS.flatMap((l) => [l.title, l.blurb, ...l.steps, ...(l.tryIt.kind === "link" ? [l.tryIt.label] : [])]);
    for (const t of text) expect(t, t).not.toMatch(/[–—]/);
  });
});
