import { describe, expect, it } from "vitest";
import { MAX_SUGGESTIONS, normalizeSuggestions, suggestInput, type PastTicket } from "./bash-suggest";

const t = (title: string, group: PastTicket["group"] = "open"): PastTicket => ({ title, group });
const tickets = [
  t("Pay button does nothing", "open"),
  t("Cart total ignores promo code", "progress"),
  t("Checkout address form loses focus", "done"),
  t("Sign-in blank on Safari", "open"),
  t("Password reset email never arrives", "closed"),
  t("CSV export drops the last row", "done"),
  t("CSV export has wrong dates", "done"),
];

describe("suggestInput", () => {
  it("numbers the titles from 1, one a line", () => {
    expect(suggestInput([t("A  b"), t("C\nd")])).toBe("[1] A b\n[2] C d");
  });
});

describe("normalizeSuggestions", () => {
  it("counts bugs and open bugs from the tickets, most open first", () => {
    const got = normalizeSuggestions(tickets, {
      areas: [
        { name: "CSV export", tickets: [6, 7] },
        { name: "Checkout", tickets: [1, 2, 3] },
        { name: "Sign-in", tickets: [4, 5] },
      ],
    });
    expect(got).toEqual([
      { name: "Checkout", bugs: 3, open: 2 },
      { name: "Sign-in", bugs: 2, open: 1 },
      { name: "CSV export", bugs: 2, open: 0 },
    ]);
  });

  it("never trusts numbers the model made up", () => {
    const got = normalizeSuggestions(tickets, { areas: [{ name: "Checkout", tickets: [1, 2, 99, 0, -3, 1.5, "3"] }] });
    expect(got).toEqual([{ name: "Checkout", bugs: 2, open: 2 }]);
  });

  it("drops an area with fewer than two real tickets", () => {
    expect(normalizeSuggestions(tickets, { areas: [{ name: "Sign-in", tickets: [4] }] })).toEqual([]);
    expect(normalizeSuggestions(tickets, { areas: [{ name: "Sign-in", tickets: [4, 4] }] })).toEqual([]);
  });

  it("counts a ticket for the first area that names it", () => {
    const got = normalizeSuggestions(tickets, {
      areas: [
        { name: "Checkout", tickets: [1, 2] },
        { name: "Payments", tickets: [1, 2, 3] },
      ],
    });
    expect(got).toEqual([{ name: "Checkout", bugs: 2, open: 2 }]);
  });

  it("cleans the name and drops a repeat or an empty one", () => {
    const got = normalizeSuggestions(tickets, {
      areas: [
        { name: "  Checkout  bug bash. ", tickets: [1, 2] },
        { name: "checkout", tickets: [3, 4] },
        { name: " ", tickets: [5, 6] },
      ],
    });
    expect(got).toEqual([{ name: "Checkout", bugs: 2, open: 2 }]);
  });

  it("keeps at most the allowed number", () => {
    const many = Array.from({ length: 20 }, (_, i) => t(`Bug ${i}`));
    const got = normalizeSuggestions(many, {
      areas: Array.from({ length: 6 }, (_, a) => ({ name: `Area ${a}`, tickets: [a * 2 + 1, a * 2 + 2] })),
    });
    expect(got).toHaveLength(MAX_SUGGESTIONS);
  });

  it("is empty for a useless answer", () => {
    for (const raw of [null, undefined, {}, { areas: "x" }, { areas: [null] }] as never[]) {
      expect(normalizeSuggestions(tickets, raw)).toEqual([]);
    }
  });
});
