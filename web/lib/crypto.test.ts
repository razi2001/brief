import { describe, it, expect } from "vitest";
import { encryptToken, decryptToken } from "./crypto";

const KEY = Buffer.alloc(32, 7).toString("base64"); // deterministic test key

describe("token crypto", () => {
  it("round-trips a value", () => {
    const cipher = encryptToken("lin_oauth_secret", KEY);
    expect(cipher).not.toContain("lin_oauth_secret");
    expect(decryptToken(cipher, KEY)).toBe("lin_oauth_secret");
  });
  it("produces different ciphertext each call (random IV)", () => {
    expect(encryptToken("x", KEY)).not.toBe(encryptToken("x", KEY));
  });
  it("fails to decrypt with the wrong key", () => {
    const other = Buffer.alloc(32, 9).toString("base64");
    expect(() => decryptToken(encryptToken("x", KEY), other)).toThrow();
  });
});
