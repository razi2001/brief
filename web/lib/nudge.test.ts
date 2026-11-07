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
  cardStatuses,
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

describe("cardStatuses", () => {
  const P = (id: string, user_id: string | null, at: string) => ({ id, user_id, created_at: `2026-11-0${at}T10:00:00Z` });
  const E = (user_id: string, name: string, push: string) => ({ user_id, name, push });

  it("each person: their newest push, theirs or everyone's, and the furthest thing they did", () => {
    const pushes = [P("all1", null, "5"), P("a1", "user_a", "6"), P("b1", "user_b", "4")];
    const events = [E("user_a", "nudge.shown", "a1"), E("user_a", "nudge.closed", "a1"), E("user_b", "nudge.brief_it", "b1"), E("user_c", "nudge.shown", "all1")];
    const r = cardStatuses(pushes, events, ["user_a", "user_b", "user_c", "user_d"]);
    expect(r.people.user_a).toEqual({ at: "2026-11-06T10:00:00Z", status: "closed" });
    // b's own push is older than the everyone push: that's the one that counts, and b hasn't seen it
    expect(r.people.user_b).toEqual({ at: "2026-11-05T10:00:00Z", status: "sent" });
    expect(r.people.user_c.status).toBe("shown");
    expect(r.people.user_d.status).toBe("sent");
    expect(r.everyone).toEqual({ at: "2026-11-05T10:00:00Z", shown: 1, closed: 0, briefed: 0 });
  });

  it("Brief it beats closed, whatever the order", () => {
    const r = cardStatuses([P("a1", "user_a", "6")], [E("user_a", "nudge.brief_it", "a1"), E("user_a", "nudge.shown", "a1")], ["user_a"]);
    expect(r.people.user_a.status).toBe("briefed");
  });

  it("nothing sent: no status, no everyone line", () => {
    expect(cardStatuses([], [], ["user_a"])).toEqual({ people: {}, everyone: null });
  });
});
