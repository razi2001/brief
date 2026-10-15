import { afterEach, describe, expect, it, vi } from "vitest";

// The module reads process.env at import time (Next inlines NEXT_PUBLIC_* into
// the client bundle), so each case re-imports it with the env it wants.
async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import("@/lib/clerk-strategies");
}

const ENV_KEYS = [
  "NEXT_PUBLIC_LINEAR_CLERK_STRATEGY",
  "NEXT_PUBLIC_JIRA_CLERK_STRATEGY",
  "NEXT_PUBLIC_GITHUB_CLERK_STRATEGY",
];

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  vi.resetModules();
});

const cleared = Object.fromEntries(ENV_KEYS.map((k) => [k, undefined]));

describe("clerkStrategy", () => {
  it("uses Clerk's built-in connection when nothing is configured", async () => {
    const { clerkStrategy } = await load(cleared);
    expect(clerkStrategy("linear")).toBe("oauth_linear");
    // Jira's Clerk connection is Atlassian, not "oauth_jira".
    expect(clerkStrategy("jira")).toBe("oauth_atlassian");
    expect(clerkStrategy("github")).toBe("oauth_github");
  });

  it("switches to a custom connector when one is configured", async () => {
    // The reason this exists: built-in connections have no configurable
    // scopes, and Clerk's shared GitHub app grants only read:user/user:email -
    // which cannot create an issue. A custom connector can request `repo`.
    const { clerkStrategy } = await load({
      ...cleared,
      NEXT_PUBLIC_GITHUB_CLERK_STRATEGY: "oauth_custom_briefgh",
    });
    expect(clerkStrategy("github")).toBe("oauth_custom_briefgh");
    // Other providers are untouched.
  });

  it("ignores an empty or whitespace override rather than producing a broken strategy", async () => {
    const { clerkStrategy } = await load({
      ...cleared,
      NEXT_PUBLIC_GITHUB_CLERK_STRATEGY: "   ",
    });
    expect(clerkStrategy("github")).toBe("oauth_github");
  });


});

describe("clerkMatch", () => {
  it("strips the oauth_ prefix so it matches an account's provider string", async () => {
    const { clerkMatch } = await load(cleared);
    expect(clerkMatch("github")).toBe("github");
    expect(clerkMatch("jira")).toBe("atlassian");
  });

  it("matches the custom connector's own accounts, not the built-in ones", async () => {
    const { clerkMatch } = await load({
      ...cleared,
      NEXT_PUBLIC_GITHUB_CLERK_STRATEGY: "oauth_custom_briefgh",
    });
    // "custom_briefgh" is a substring of "oauth_custom_briefgh" but NOT of a
    // built-in "oauth_github" account - which is what keeps a leftover
    // built-in connection from being mistaken for the custom one.
    expect(clerkMatch("github")).toBe("custom_briefgh");
    expect("oauth_custom_briefgh".includes(clerkMatch("github"))).toBe(true);
    expect("oauth_github".includes(clerkMatch("github"))).toBe(false);
  });
});

describe("isCustomConnector", () => {
  it("reports which providers went custom", async () => {
    const { isCustomConnector } = await load({
      ...cleared,
      NEXT_PUBLIC_GITHUB_CLERK_STRATEGY: "oauth_custom_briefgh",
    });
    expect(isCustomConnector("github")).toBe(true);
    expect(isCustomConnector("linear")).toBe(false);
  });
});

describe("extraScopes", () => {
  // Clerk's built-in connections grant sign-in scopes only. A real grant came
  // back as read:user + user:email, which cannot create an issue - so `repo`
  // has to be requested at connect time via additionalScopes.
  it("asks for repo on a built-in GitHub connection", async () => {
    const { extraScopes } = await load(cleared);
    expect(extraScopes("github")).toEqual(["repo"]);
  });

  it("asks for nothing on providers whose connection already suffices", async () => {
    const { extraScopes } = await load(cleared);
    expect(extraScopes("linear")).toBeUndefined();
    expect(extraScopes("jira")).toBeUndefined();
  });

  // GitLab asks for `api` on Brief's own authorize URL (lib/connections), so
  // nothing about it is left here.
  it("asks Clerk for nothing on a tracker Brief connects itself", async () => {
    const { extraScopes } = await load(cleared);
    expect(extraScopes("gitlab")).toBeUndefined();
    expect(extraScopes("notion")).toBeUndefined();
  });

  // A custom connector declares base_scopes on the connection itself, so
  // repeating them here would only duplicate entries on the consent screen.
  it("stays quiet when a custom connector already declares its scopes", async () => {
    const { extraScopes } = await load({
      ...cleared,
      NEXT_PUBLIC_GITHUB_CLERK_STRATEGY: "oauth_custom_briefgh",
    });
    expect(extraScopes("github")).toBeUndefined();
  });
});
