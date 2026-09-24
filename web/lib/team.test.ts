import { describe, expect, it } from "vitest";
import { sortTeam, type TeamMember } from "./team";

const m = (userId: string, fullName: string, extra: Partial<TeamMember> = {}): TeamMember => ({
  userId,
  fullName,
  isYou: false,
  filed: 0,
  ...extra,
});

describe("sortTeam", () => {
  it("puts you first", () => {
    const out = sortTeam([m("a", "Ana"), m("r", "Razi", { isYou: true })]);
    expect(out.map((x) => x.fullName)).toEqual(["Razi", "Ana"]);
  });

  it("sorts everyone else by name, ignoring case", () => {
    const out = sortTeam([m("1", "bob"), m("2", "Alice"), m("3", "carol")]);
    expect(out.map((x) => x.fullName)).toEqual(["Alice", "bob", "carol"]);
  });

  it("orders by name, not by tickets filed", () => {
    const out = sortTeam([m("1", "Zoe", { filed: 90 }), m("2", "Adam", { filed: 1 })]);
    expect(out.map((x) => x.fullName)).toEqual(["Adam", "Zoe"]);
  });

  it("keeps two people with the same name in a stable order", () => {
    const out = sortTeam([m("b", "Sam"), m("a", "Sam")]);
    expect(out.map((x) => x.userId)).toEqual(["a", "b"]);
  });

  it("leaves the caller's array alone", () => {
    const input = [m("1", "bob"), m("2", "Alice")];
    sortTeam(input);
    expect(input.map((x) => x.fullName)).toEqual(["bob", "Alice"]);
  });
});
