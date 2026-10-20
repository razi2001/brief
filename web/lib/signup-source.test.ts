import { describe, expect, it } from "vitest";
import { signupSource } from "./signup-source";

describe("signupSource", () => {
  it("keeps the known params, trimmed and capped", () => {
    expect(signupSource({ src: " hero ", utm_source: "linkedin", ref: "www.linkedin.com", x: "y" })).toEqual({
      src: "hero",
      utm_source: "linkedin",
      ref: "www.linkedin.com",
    });
    expect(signupSource({ src: "a".repeat(100) })?.src).toHaveLength(60);
  });

  it("is null with nothing to keep, and takes the first of repeated params", () => {
    expect(signupSource({})).toBeNull();
    expect(signupSource({ src: "  " })).toBeNull();
    expect(signupSource({ src: ["nav", "hero"] })).toEqual({ src: "nav" });
  });
});
