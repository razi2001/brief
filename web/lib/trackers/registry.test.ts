import { describe, expect, it, vi } from "vitest";

// The adapters reach for Clerk at import time; that isn't needed to assert the
// registry's own shape.
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: async () => null }));

import { PROVIDERS, providerDef, providerName, resolveTracker } from "@/lib/trackers/registry";
import { PROVIDER_KEYS } from "@/lib/ticket-sync";
import { makeGithubTracker } from "@/lib/github";
import { makeLinearTracker } from "@/lib/linear";
import { makeJiraTracker } from "@/lib/jira";
import type { Tracker } from "@/lib/tracker";

describe("the registry covers every provider exactly once", () => {
  it("registers every ProviderKey", () => {
    expect(PROVIDERS.map((p) => p.key).sort()).toEqual([...PROVIDER_KEYS].sort());
  });

  it("registers no provider twice", () => {
    const keys = PROVIDERS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps Linear and Jira first, so existing users' resolution order is unchanged", () => {
    expect(PROVIDERS.slice(0, 2).map((p) => p.key)).toEqual(["linear", "jira"]);
  });

  it("gives every provider a Clerk strategy and a match string", () => {
    for (const def of PROVIDERS) {
      expect(def.clerkStrategy, def.key).toBeTruthy();
      expect(def.clerkMatch, def.key).toBeTruthy();
    }
  });

  it("names every provider", () => {
    for (const key of PROVIDER_KEYS) expect(providerName(key)).not.toBe(key);
    expect(providerDef("github")?.name).toBe("GitHub");
  });
});

// Every adapter is built with a throwaway token: none of these calls touch the
// network, they only assert the shape the rest of the app relies on.
const ADAPTERS: Array<[string, () => Tracker]> = [
  ["linear", () => makeLinearTracker({ token: "t" })],
  ["jira", () => makeJiraTracker({ token: "t", kind: "oauth" }, { cloudId: "c", siteUrl: "https://x" })],
  ["github", () => makeGithubTracker({ token: "t" })],
];

describe("every adapter satisfies the Tracker contract", () => {
  it.each(ADAPTERS)("%s", (key, build) => {
    const t = build();
    expect(t.kind).toBe(key);
    // The noun is shown to the model as the word for a filing destination, so
    // it has to be real - "team", "repository", not a placeholder.
    expect(t.targetNoun).toMatch(/^[a-z ]+$/);
    for (const method of [
      "listTargets",
      "searchIssues",
      "getTargetDetails",
      "fileIssue",
      "updateIssue",
      "getIssue",
      "getLiveIssues",
    ] as const) {
      expect(typeof t[method], `${key}.${method}`).toBe("function");
    }
  });

  it.each(ADAPTERS)("%s declares complete capabilities", (_key, build) => {
    const caps = build().capabilities;
    for (const flag of [
      "projects",
      "states",
      "priority",
      "labels",
      "customFields",
      "issueTypes",
      "comments",
      "nativeAttachments",
    ] as const) {
      expect(typeof caps[flag]).toBe("boolean");
    }
  });

  it("marks GitHub as the tracker with no upload API", () => {
    // GitHub has no public image-upload API, which is why briefs keep their
    // screenshots after filing and the evidence route exists at all.
    const byUrl = ADAPTERS.filter(([, build]) => !build().capabilities.nativeAttachments).map(
      ([key]) => key,
    );
    expect(byUrl).toEqual(["github"]);
  });

  it("gives GitHub a body guidance line", () => {
    // Linear and Jira predate this and take markdown through their own
    // converters; GitHub explains its own body format to the agent.
    const guided = ADAPTERS.filter(([, build]) => !!build().bodyGuidance).map(([key]) => key);
    expect(guided).toEqual(["github"]);
  });
});

describe("resolveTracker", () => {
  it("returns null when nothing is connected", async () => {
    // No Clerk client: every resolve degrades to null.
    await expect(resolveTracker("user_1")).resolves.toBeNull();
  });

  it("returns null for a pinned provider that isn't connected, rather than another one", async () => {
    // A brief filed to Jira must never be re-filed somewhere else.
    await expect(resolveTracker("user_1", "jira")).resolves.toBeNull();
  });
});
