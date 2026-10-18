import { describe, expect, it } from "vitest";
import { isShareId, isUniqueViolation, newShareId } from "./share-id";

describe("share ids", () => {
  it("mints 12 url-safe characters", () => {
    for (let i = 0; i < 50; i++) {
      const id = newShareId();
      expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
      expect(isShareId(id)).toBe(true);
    }
  });

  it("takes only the exact shape from a client", () => {
    expect(isShareId("axCGXn-LhdIe")).toBe(true);
    expect(isShareId("axCGXn-LhdI")).toBe(false); // short
    expect(isShareId("axCGXn-LhdIeX")).toBe(false); // long
    expect(isShareId("axCGXn+LhdIe")).toBe(false); // not base64url
    expect(isShareId("../../etc/pas")).toBe(false);
    expect(isShareId(null)).toBe(false);
    expect(isShareId(123456789012)).toBe(false);
  });

  it("knows a unique violation", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
