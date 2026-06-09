import { describe, it, expect } from "vitest";
import { generateExtensionToken, hashToken, verifyToken } from "./tokens";

describe("extension tokens", () => {
  it("generates a prefixed, high-entropy token", () => {
    const t = generateExtensionToken();
    expect(t).toMatch(/^bxt_[A-Za-z0-9_-]{43}$/);
  });
  it("hash is stable and verifies", () => {
    const t = generateExtensionToken();
    const h = hashToken(t);
    expect(hashToken(t)).toBe(h);
    expect(verifyToken(t, h)).toBe(true);
    expect(verifyToken(t + "x", h)).toBe(false);
  });
});
