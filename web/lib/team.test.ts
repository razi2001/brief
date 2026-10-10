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
  it("puts whoever filed the most tickets first", () => {
    const out = sortTeam([m("1", "Adam", { filed: 1 }), m("2", "Zoe", { filed: 90 }), m("r", "Razi", { isYou: true, filed: 44 })]);
    expect(out.map((x) => x.fullName)).toEqual(["Zoe", "Razi", "Adam"]);
  });

  it("breaks a tie by name, ignoring case", () => {
    const out = sortTeam([m("1", "bob"), m("2", "Alice"), m("3", "carol")]);
    expect(out.map((x) => x.fullName)).toEqual(["Alice", "bob", "carol"]);
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
