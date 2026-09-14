import { describe, it, expect } from "vitest";
import { diffLines } from "./text-diff";

describe("diffLines", () => {
  it("marks every line unchanged when the text is identical", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });

  it("marks an added line", () => {
    expect(diffLines("a", "a\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "add", text: "b" },
    ]);
  });

  it("marks a removed line", () => {
    expect(diffLines("a\nb", "a")).toEqual([
      { kind: "same", text: "a" },
      { kind: "remove", text: "b" },
    ]);
  });

  it("shows a replaced line as a removal followed by an addition", () => {
    expect(diffLines("Status: Triage.", "Status: Backlog.")).toEqual([
      { kind: "remove", text: "Status: Triage." },
      { kind: "add", text: "Status: Backlog." },
    ]);
  });

  it("keeps surrounding context around an edit", () => {
    const out = diffLines("keep\nold\ntail", "keep\nnew\ntail");
    expect(out).toEqual([
      { kind: "same", text: "keep" },
      { kind: "remove", text: "old" },
      { kind: "add", text: "new" },
      { kind: "same", text: "tail" },
    ]);
  });

  it("treats the whole of a previously empty text as added", () => {
    expect(diffLines("", "a\nb")).toEqual([
      { kind: "add", text: "a" },
      { kind: "add", text: "b" },
    ]);
  });

  it("treats a cleared text as all removed", () => {
    expect(diffLines("a\nb", "")).toEqual([
      { kind: "remove", text: "a" },
      { kind: "remove", text: "b" },
    ]);
  });

  it("returns nothing for two empty texts", () => {
    expect(diffLines("", "")).toEqual([]);
  });

  it("normalizes CRLF so a line-ending change alone is not a diff", () => {
    expect(diffLines("a\r\nb", "a\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });

  it("finds the longest common run rather than rewriting everything", () => {
    const out = diffLines("a\nb\nc\nd", "a\nb\nx\nc\nd");
    expect(out.filter((l) => l.kind !== "same")).toEqual([{ kind: "add", text: "x" }]);
  });
});
