import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUTTON,
  DEFAULT_MESSAGE,
  MAX_BUTTON,
  MAX_MESSAGE,
  PUSH_TTL_MS,
  cleanText,
  effectiveText,
  isUserId,
  livePush,
  parseText,
} from "./nudge";

describe("card text", () => {
  it("falls back to the built-in text when nothing is saved", () => {
    expect(effectiveText(null)).toEqual({ message: DEFAULT_MESSAGE, button: DEFAULT_BUTTON });
    expect(effectiveText({ message: "  ", button: "" })).toEqual({ message: DEFAULT_MESSAGE, button: DEFAULT_BUTTON });
  });

  it("uses what the owner saved, on one line, capped", () => {
    expect(effectiveText({ message: " Found\n a  glitch? ", button: "Report" })).toEqual({ message: "Found a glitch?", button: "Report" });
    expect(cleanText("x".repeat(200), MAX_MESSAGE)).toHaveLength(MAX_MESSAGE);
    expect(effectiveText({ button: "y".repeat(50) }).button).toHaveLength(MAX_BUTTON);
  });

  it("parses a PUT body, empty allowed, wrong types refused", () => {
    expect(parseText({ message: " Hi ", button: "" })).toEqual({ message: "Hi", button: "" });
    expect(parseText({})).toEqual({ message: "", button: "" });
    expect(parseText({ message: 3 })).toBeNull();
    expect(parseText(null)).toBeNull();
  });
});

describe("pushes", () => {
  const NOW = Date.UTC(2026, 10, 7, 12);
  it("keeps a push for 3 days, then drops it", () => {
    const at = (ms: number) => ({ id: "p", at: new Date(NOW - ms).toISOString() });
    expect(livePush(at(60_000), NOW)).toEqual(at(60_000));
    expect(livePush(at(PUSH_TTL_MS - 1), NOW)).not.toBeNull();
    expect(livePush(at(PUSH_TTL_MS), NOW)).toBeNull();
    expect(livePush(null, NOW)).toBeNull();
    expect(livePush({ id: "p", at: "nope" }, NOW)).toBeNull();
  });

  it("only takes Clerk-shaped user ids (they go into a filter string)", () => {
    expect(isUserId("user_2abcDEF123")).toBe(true);
    expect(isUserId("x,user_id.is.null")).toBe(false);
    expect(isUserId("")).toBe(false);
    expect(isUserId(42)).toBe(false);
  });
});
