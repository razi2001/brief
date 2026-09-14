import { describe, it, expect } from "vitest";
import { workspaceSlug, inferMemberships } from "./org-infer";

describe("workspaceSlug", () => {
  it("reads the workspace out of a Linear issue url", () => {
    expect(
      workspaceSlug("https://linear.app/thunders/issue/AI-2152/copilot-mixes-languages"),
    ).toBe("thunders");
  });

  it("is case-insensitive, since the slug is", () => {
    expect(workspaceSlug("https://linear.app/Thunders/issue/AI-1/x")).toBe("thunders");
  });

  it("ignores urls from other trackers", () => {
    expect(workspaceSlug("https://acme.atlassian.net/browse/PROJ-1")).toBeNull();
    expect(workspaceSlug("https://github.com/acme/repo/issues/3")).toBeNull();
  });

  it("ignores a linear url with no workspace segment", () => {
    expect(workspaceSlug("https://linear.app/")).toBeNull();
    expect(workspaceSlug("")).toBeNull();
    expect(workspaceSlug(null)).toBeNull();
  });
});

describe("inferMemberships", () => {
  const thunders = { orgKey: "linear:abc", orgName: "Thunders" };

  it("places someone whose tickets went to a workspace a known member files into", () => {
    const out = inferMemberships({
      tickets: [
        { userId: "known", url: "https://linear.app/thunders/issue/AI-1/x" },
        { userId: "mokhtar", url: "https://linear.app/thunders/issue/APP-2/y" },
      ],
      resolved: new Map([["known", thunders]]),
    });
    expect(out).toEqual([
      { userId: "mokhtar", orgKey: "linear:abc", orgName: "Thunders" },
    ]);
  });

  it("leaves alone anyone who files into an unrecognised workspace", () => {
    const out = inferMemberships({
      tickets: [
        { userId: "known", url: "https://linear.app/thunders/issue/AI-1/x" },
        { userId: "stranger", url: "https://linear.app/someone-else/issue/X-1/y" },
      ],
      resolved: new Map([["known", thunders]]),
    });
    expect(out).toEqual([]);
  });

  it("never re-places someone already resolved from their own token", () => {
    const out = inferMemberships({
      tickets: [{ userId: "known", url: "https://linear.app/thunders/issue/AI-1/x" }],
      resolved: new Map([["known", thunders]]),
    });
    expect(out).toEqual([]);
  });

  it("refuses to guess when one workspace maps to two different orgs", () => {
    // Shouldn't happen, but if the data is contradictory, assigning either one
    // would put someone in a workspace they may not belong to.
    const out = inferMemberships({
      tickets: [
        { userId: "a", url: "https://linear.app/shared/issue/A-1/x" },
        { userId: "b", url: "https://linear.app/shared/issue/B-1/x" },
        { userId: "new", url: "https://linear.app/shared/issue/C-1/x" },
      ],
      resolved: new Map([
        ["a", { orgKey: "linear:one", orgName: "One" }],
        ["b", { orgKey: "linear:two", orgName: "Two" }],
      ]),
    });
    expect(out).toEqual([]);
  });

  it("uses the workspace someone files into most, not whichever came first", () => {
    const out = inferMemberships({
      tickets: [
        { userId: "known", url: "https://linear.app/thunders/issue/AI-1/x" },
        { userId: "guest", url: "https://linear.app/elsewhere/issue/E-1/x" },
        { userId: "guest", url: "https://linear.app/thunders/issue/AI-2/x" },
        { userId: "guest", url: "https://linear.app/thunders/issue/AI-3/x" },
      ],
      resolved: new Map([["known", thunders]]),
    });
    expect(out).toEqual([{ userId: "guest", orgKey: "linear:abc", orgName: "Thunders" }]);
  });

  it("returns one entry per person, not one per ticket", () => {
    const out = inferMemberships({
      tickets: [
        { userId: "known", url: "https://linear.app/thunders/issue/AI-1/x" },
        { userId: "m", url: "https://linear.app/thunders/issue/A-1/x" },
        { userId: "m", url: "https://linear.app/thunders/issue/A-2/x" },
      ],
      resolved: new Map([["known", thunders]]),
    });
    expect(out).toHaveLength(1);
  });

  it("never maps a Linear workspace onto a non-Linear org", () => {
    // Someone resolved via Jira can still file Linear tickets. Sharing their
    // Linear workspace says nothing about sharing their Jira site.
    const out = inferMemberships({
      tickets: [
        { userId: "jiraperson", url: "https://linear.app/n3dhir/issue/N3D-1/x" },
        { userId: "other", url: "https://linear.app/n3dhir/issue/N3D-2/x" },
      ],
      resolved: new Map([
        ["jiraperson", { orgKey: "jira:site-1", orgName: "Drivago" }],
      ]),
    });
    expect(out).toEqual([]);
  });

  it("does nothing without at least one resolved member to learn from", () => {
    const out = inferMemberships({
      tickets: [{ userId: "m", url: "https://linear.app/thunders/issue/A-1/x" }],
      resolved: new Map(),
    });
    expect(out).toEqual([]);
  });
});
