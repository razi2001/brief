import { describe, it, expect } from "vitest";
import { explainFilingError } from "./filing-errors";

describe("explainFilingError", () => {
  it("replaces the old bare 'agent did not create an issue'", () => {
    expect(explainFilingError("agent did not create an issue", "Jira")).toBe(
      "The ticket wasn't created: Brief's AI stopped before filing it in Jira. Press Retry, or open the draft and file it yourself.",
    );
  });

  it("keeps Brief's own explicit messages as they are", () => {
    const m = "The ticket wasn't created. Jira project EWO requires Story Points (a number).";
    expect(explainFilingError(m)).toBe(m);
    const r = "Jira rejected the ticket in project EWO: Components is required.";
    expect(explainFilingError(r)).toBe(r);
  });

  it("says to reconnect on a 401", () => {
    expect(explainFilingError('Linear API failed: 401 {"error":"unauthorized"}')).toBe(
      "Your Linear connection expired. Reconnect Linear in Connections, then press Retry.",
    );
  });

  it("says who refused and why on a 400, from the JSON body", () => {
    expect(
      explainFilingError('Azure DevOps work item create failed: 400 {"message":"TF401320: Rule Error for field Area Path"}'),
    ).toBe("Azure DevOps refused the ticket: TF401320: Rule Error for field Area Path. Fix that in your ticket guidance (or in Azure DevOps), then press Retry.");
  });

  it("explains permissions, missing targets, rate limits and outages", () => {
    expect(explainFilingError("GitHub /repos/a/b/issues failed: 403 {}")).toMatch(/^Your GitHub account isn't allowed to create tickets there/);
    expect(explainFilingError("Trello /cards failed: 404 not found")).toMatch(/^Trello couldn't find where to file the ticket/);
    expect(explainFilingError("ClickUp /task failed: 429 slow down")).toBe("ClickUp is limiting requests right now. Wait a minute, then press Retry.");
    expect(explainFilingError("Notion /pages failed: 502 bad gateway")).toBe("Notion had a problem on its side (error 502). Wait a minute, then press Retry.");
  });

  it("explains a network failure", () => {
    expect(explainFilingError("fetch failed", "Jira")).toBe("Brief couldn't reach Jira (no answer). Press Retry in a minute.");
  });

  it("keeps a plain sentence, and still explains an unknown technical one", () => {
    expect(explainFilingError("Connect a tracker first.")).toBe("Connect a tracker first.");
    expect(explainFilingError("TypeError: cannot read properties of undefined", "Jira")).toMatch(
      /^The ticket didn't file in Jira: TypeError/,
    );
  });

  it("explains a draft that couldn't be written", () => {
    expect(explainFilingError("OpenAI 429 rate limited", undefined, { stage: "draft" })).toMatch(/^Brief's AI service didn't answer while writing the draft/);
  });

  it("never returns an empty message", () => {
    expect(explainFilingError(null)).toMatch(/^The ticket didn't file/);
  });
});
