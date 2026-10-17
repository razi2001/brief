import { describe, expect, it } from "vitest";
import { clerkMatches, countClerkTrackers, formatCounts } from "./count-clerk-trackers.mjs";

const verified = (provider: string) => ({ provider, verification: { status: "verified" } });
const unverified = (provider: string) => ({ provider, verification: { status: "unverified" } });

const builtIn = clerkMatches({});

describe("countClerkTrackers", () => {
  it("counts each tracker's users still on a verified Clerk account, and those with a Brief row too", () => {
    const users = [
      { id: "u1", external_accounts: [verified("oauth_linear")] },
      { id: "u2", external_accounts: [verified("oauth_linear"), verified("oauth_google")] },
      { id: "u3", external_accounts: [verified("oauth_atlassian")] },
      { id: "u4", external_accounts: [verified("oauth_github"), verified("oauth_linear")] },
      { id: "u5", external_accounts: [verified("oauth_google")] },
      { id: "u6", external_accounts: [] },
      { id: "u7" },
    ];
    const rows = [
      { user_id: "u2", provider: "linear" },
      // A Brief row for another tracker doesn't make u3's Jira moved.
      { user_id: "u3", provider: "github" },
      // Rows of users on another Clerk instance count for nothing here.
      { user_id: "other", provider: "linear" },
    ];

    expect(countClerkTrackers(users, rows, builtIn)).toEqual({
      users: 7,
      anyClerk: 4,
      trackers: {
        linear: { clerk: 3, alsoBrief: 1, unverified: 0 },
        jira: { clerk: 1, alsoBrief: 0, unverified: 0 },
        github: { clerk: 1, alsoBrief: 0, unverified: 0 },
      },
    });
  });

  it("counts a user whose only account for a tracker never verified apart, not as connected", () => {
    const users = [
      { id: "u1", external_accounts: [unverified("oauth_github")] },
      { id: "u2", external_accounts: [unverified("oauth_github"), verified("oauth_github")] },
    ];
    expect(countClerkTrackers(users, [], builtIn).trackers.github).toEqual({ clerk: 1, alsoBrief: 0, unverified: 1 });
  });

  it("counts a user once per tracker, however many accounts they have for it", () => {
    const users = [{ id: "u1", external_accounts: [verified("oauth_linear"), verified("oauth_linear")] }];
    expect(countClerkTrackers(users, [], builtIn).trackers.linear.clerk).toBe(1);
  });

  it("matches a configured custom connector beside the built-in one", () => {
    const matches = clerkMatches({ NEXT_PUBLIC_GITHUB_CLERK_STRATEGY: " oauth_custom_briefgh " });
    expect(matches.github).toEqual(["github", "custom_briefgh"]);
    const users = [
      { id: "u1", external_accounts: [verified("oauth_custom_briefgh")] },
      { id: "u2", external_accounts: [verified("oauth_github")] },
    ];
    expect(countClerkTrackers(users, [], matches).trackers.github.clerk).toBe(2);
    expect(countClerkTrackers(users, [], builtIn).trackers.github.clerk).toBe(1);
  });

  it("prints counts only", () => {
    const users = [{ id: "user_secret", external_accounts: [verified("oauth_linear")] }];
    const out = formatCounts(countClerkTrackers(users, [], builtIn), "production");
    expect(out).toContain("Clerk users scanned (production): 1");
    expect(out).toMatch(/linear\s+1\s+0\s+0/);
    expect(out).not.toContain("user_secret");
  });
});
