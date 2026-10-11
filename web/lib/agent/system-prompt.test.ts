import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "./system-prompt";
import { buildContextBlock } from "./context-block";

describe("tickets read functionally; technical detail stays apart", () => {
  it("keeps the summary, steps, Expected and Actual functional", () => {
    expect(SYSTEM_PROMPT).toMatch(/Expected and Actual are FUNCTIONAL/);
    expect(SYSTEM_PROMPT).toMatch(/Never put an endpoint, HTTP method, status code/);
  });
  it("puts a failing call or error in its own Technical notes section, only when it explains the bug", () => {
    expect(SYSTEM_PROMPT).toMatch(/\*\*Technical notes\*\* - a separate section at the end, ONLY when/);
    expect(SYSTEM_PROMPT).not.toMatch(/name it in one line in the summary or under Actual/);
  });
  it("one-click reports follow the same rule", () => {
    expect(buildContextBlock({ autoReport: true })).toMatch(/title, summary, Expected and Actual stay functional/);
  });
});
