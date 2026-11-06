import { describe, expect, it } from "vitest";
import {
  MAX_BODY,
  MAX_TITLE,
  STATUSES,
  cleanBody,
  cleanTitle,
  filterRequests,
  isRequestId,
  isStatus,
  sortRequests,
  statusCounts,
  type RequestItem,
} from "./requests";

const item = (over: Partial<RequestItem>): RequestItem => ({
  id: "id",
  title: "A request",
  body: "",
  status: "open",
  createdAt: "2026-11-01T10:00:00Z",
  votes: 1,
  voted: false,
  mine: false,
  ...over,
});

describe("cleanTitle", () => {
  it("trims and folds whitespace into single spaces", () => {
    expect(cleanTitle("  Dark \n  mode  ")).toBe("Dark mode");
  });
  it("refuses a title that is missing, not text, or too short", () => {
    expect(cleanTitle(undefined)).toBeNull();
    expect(cleanTitle(42)).toBeNull();
    expect(cleanTitle("   ")).toBeNull();
    expect(cleanTitle("ab")).toBeNull();
  });
  it("cuts a long title at the cap", () => {
    expect(cleanTitle("x".repeat(MAX_TITLE + 50))).toHaveLength(MAX_TITLE);
  });
});

describe("cleanBody", () => {
  it("keeps line breaks, trims the ends, and caps the length", () => {
    expect(cleanBody("  one\ntwo  ")).toBe("one\ntwo");
    expect(cleanBody("y".repeat(MAX_BODY + 10))).toHaveLength(MAX_BODY);
  });
  it("is empty for anything that is not text", () => {
    expect(cleanBody(undefined)).toBe("");
    expect(cleanBody(7)).toBe("");
  });
});

describe("isStatus", () => {
  it("accepts exactly the five statuses", () => {
    for (const s of STATUSES) expect(isStatus(s)).toBe(true);
    expect(isStatus("done")).toBe(false);
    expect(isStatus(undefined)).toBe(false);
  });
});

describe("isRequestId", () => {
  it("accepts a uuid and nothing else", () => {
    expect(isRequestId("3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b")).toBe(true);
    expect(isRequestId("3f2b8c1e")).toBe(false);
    expect(isRequestId("1; drop table feature_requests")).toBe(false);
    expect(isRequestId(undefined)).toBe(false);
  });
});

describe("sortRequests", () => {
  const items = [
    item({ id: "old-popular", votes: 9, createdAt: "2026-10-01T00:00:00Z" }),
    item({ id: "new-quiet", votes: 1, createdAt: "2026-11-05T00:00:00Z" }),
    item({ id: "new-popular", votes: 9, createdAt: "2026-11-04T00:00:00Z" }),
  ];
  it("top: most votes first, the newer one winning a tie", () => {
    expect(sortRequests(items, "top").map((i) => i.id)).toEqual(["new-popular", "old-popular", "new-quiet"]);
  });
  it("new: newest first whatever the votes", () => {
    expect(sortRequests(items, "new").map((i) => i.id)).toEqual(["new-quiet", "new-popular", "old-popular"]);
  });
  it("does not reorder the list it was given", () => {
    const before = items.map((i) => i.id);
    sortRequests(items, "top");
    expect(items.map((i) => i.id)).toEqual(before);
  });
});

describe("filterRequests / statusCounts", () => {
  const items = [
    item({ id: "1", status: "open" }),
    item({ id: "2", status: "open" }),
    item({ id: "3", status: "shipped" }),
  ];
  it("all keeps everything, a status keeps only that status", () => {
    expect(filterRequests(items, "all")).toHaveLength(3);
    expect(filterRequests(items, "shipped").map((i) => i.id)).toEqual(["3"]);
    expect(filterRequests(items, "declined")).toEqual([]);
  });
  it("counts every status, zeros included", () => {
    expect(statusCounts(items)).toEqual({ all: 3, open: 2, planned: 0, in_progress: 0, shipped: 1, declined: 0 });
  });
});
