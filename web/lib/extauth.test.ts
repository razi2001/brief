import { describe, it, expect } from "vitest";
import { bearerFromHeader } from "./extauth";

describe("bearerFromHeader", () => {
  it("extracts the token", () => {
    expect(bearerFromHeader("Bearer bxt_abc")).toBe("bxt_abc");
  });
  it("returns null when missing/malformed", () => {
    expect(bearerFromHeader(null)).toBeNull();
    expect(bearerFromHeader("Basic xyz")).toBeNull();
    expect(bearerFromHeader("Bearer ")).toBeNull();
  });
});
