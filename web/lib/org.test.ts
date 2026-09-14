import { describe, it, expect } from "vitest";
import { orgKey } from "./org";

describe("orgKey", () => {
  it("namespaces the id by provider", () => {
    expect(orgKey("linear", "abc-123")).toBe("linear:abc-123");
    expect(orgKey("jira", "cloud-9")).toBe("jira:cloud-9");
  });

  it("lowercases a GitHub org login, which is case-insensitive upstream", () => {
    expect(orgKey("github", "Acme-Corp")).toBe("github:acme-corp");
  });

  it("does not lowercase ids from providers whose ids are case-sensitive", () => {
    expect(orgKey("linear", "AbC")).toBe("linear:AbC");
  });

  it("trims surrounding whitespace", () => {
    expect(orgKey("github", "  acme  ")).toBe("github:acme");
  });

  it("returns null for a blank id rather than a key nobody can be in", () => {
    expect(orgKey("linear", "")).toBeNull();
    expect(orgKey("linear", "   ")).toBeNull();
  });

  it("keeps a Jira basic-auth sentinel id intact, colons and all", () => {
    expect(orgKey("jira", "basic:https://x.atlassian.net")).toBe(
      "jira:basic:https://x.atlassian.net",
    );
  });
});
