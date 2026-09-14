import { describe, it, expect } from "vitest";
import { effectiveGuidance, migratedMode } from "./guidance";

describe("effectiveGuidance", () => {
  it("uses the personal override when the mode is override", () => {
    expect(
      effectiveGuidance({
        mode: "override",
        personal: "Always assign to me.",
        org: "Status: Triage.",
      }),
    ).toBe("Always assign to me.");
  });

  it("ignores the org guidance entirely when overriding - never merges", () => {
    const out = effectiveGuidance({
      mode: "override",
      personal: "Always assign to me.",
      org: "Status: Triage.",
    });
    expect(out).not.toContain("Triage");
  });

  it("uses the org guidance when the mode is inherit", () => {
    expect(
      effectiveGuidance({
        mode: "inherit",
        personal: "Always assign to me.",
        org: "Status: Triage.",
      }),
    ).toBe("Status: Triage.");
  });

  it("returns an empty string when inheriting with no org guidance", () => {
    expect(effectiveGuidance({ mode: "inherit", personal: "mine", org: "" })).toBe("");
  });

  it("honours a deliberate empty override rather than falling back to the org", () => {
    expect(
      effectiveGuidance({ mode: "override", personal: "", org: "Status: Triage." }),
    ).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(
      effectiveGuidance({ mode: "override", personal: "  spaced  ", org: "" }),
    ).toBe("spaced");
  });

  it("treats a missing org as no org guidance", () => {
    expect(effectiveGuidance({ mode: "inherit", personal: "mine" })).toBe("");
  });
});

describe("migratedMode", () => {
  it("migrates an existing user with guidance to override, preserving behaviour", () => {
    expect(migratedMode({ storedMode: undefined, personal: "Status: Backlog." })).toBe(
      "override",
    );
  });

  it("migrates a user with no guidance to inherit", () => {
    expect(migratedMode({ storedMode: undefined, personal: "" })).toBe("inherit");
  });

  it("treats whitespace-only guidance as no guidance", () => {
    expect(migratedMode({ storedMode: undefined, personal: "   " })).toBe("inherit");
  });

  it("respects an explicitly stored mode over the migration guess", () => {
    expect(migratedMode({ storedMode: "inherit", personal: "Status: Backlog." })).toBe(
      "inherit",
    );
    expect(migratedMode({ storedMode: "override", personal: "" })).toBe("override");
  });

  it("falls back to migration for an unrecognized stored value", () => {
    expect(migratedMode({ storedMode: "nonsense", personal: "x" })).toBe("override");
  });
});
