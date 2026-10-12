import { describe, expect, it } from "vitest";
import { addTried, countDone, isDone, parseTried } from "./progress";

const known = ["record", "replay", "assistant"];

describe("parseTried", () => {
  it("reads a stored list, keeping only lessons that exist", () => {
    expect(parseTried('["record","gone","assistant"]', known)).toEqual(["record", "assistant"]);
  });

  it("survives nothing, junk and the wrong shape", () => {
    expect(parseTried(null, known)).toEqual([]);
    expect(parseTried("{not json", known)).toEqual([]);
    expect(parseTried('{"record":true}', known)).toEqual([]);
    expect(parseTried("[1,null,\"replay\"]", known)).toEqual(["replay"]);
  });

  it("drops repeats", () => {
    expect(parseTried('["record","record"]', known)).toEqual(["record"]);
  });
});

describe("addTried", () => {
  it("adds once", () => {
    expect(addTried(["record"], "replay")).toEqual(["record", "replay"]);
    expect(addTried(["record"], "record")).toEqual(["record"]);
  });
});

describe("isDone / countDone", () => {
  const lessons = [
    { slug: "connect-tracker", auto: "tracker" as const },
    { slug: "record" },
    { slug: "ticket-rules", auto: "rules" as const },
  ];

  it("is done when the app already knows, or when tried", () => {
    expect(isDone(lessons[0], { tracker: true }, [])).toBe(true);
    expect(isDone(lessons[0], { tracker: false }, [])).toBe(false);
    expect(isDone(lessons[1], {}, ["record"])).toBe(true);
    expect(isDone(lessons[1], {}, [])).toBe(false);
  });

  it("a tried lesson with an auto fact still counts as done", () => {
    expect(isDone(lessons[2], { rules: false }, ["ticket-rules"])).toBe(true);
  });

  it("counts each lesson once", () => {
    expect(countDone(lessons, { tracker: true }, ["connect-tracker", "record"])).toBe(2);
  });
});
