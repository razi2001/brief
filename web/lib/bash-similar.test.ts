import { describe, expect, it } from "vitest";
import { alike, blocksOf, wordsOf } from "./bash-similar";

const t = (title: string) => ({ title });
const titles = (blocks: { title: string }[][]) => blocks.map((b) => b.map((r) => r.title));

describe("wordsOf", () => {
  it("keeps the meaningful words, lower case, without accents or plurals", () => {
    expect([...wordsOf("The Pay button does nothing after a declined card")].sort()).toEqual(["card", "declined", "nothing", "pay"]);
    expect([...wordsOf("Codes promo expirés")].sort()).toEqual(["code", "expire", "promo"]);
  });
  it("is empty for a title of filler only", () => {
    expect(wordsOf("Bug on the page").size).toBe(0);
    expect(wordsOf("").size).toBe(0);
  });
});

describe("alike", () => {
  it("is the share of words two titles have in common", () => {
    expect(alike(wordsOf("Pay button does nothing after a declined card"), wordsOf("Pay does nothing after declined card"))).toBe(1);
    expect(alike(wordsOf("Receipt PDF is blank on Firefox"), wordsOf("Avatar menu stays open"))).toBe(0);
  });
  it("is 0 when a title has no meaningful word, so empty titles never pile up", () => {
    expect(alike(wordsOf(""), wordsOf(""))).toBe(0);
    expect(alike(wordsOf("Bug"), wordsOf("Pay fails"))).toBe(0);
  });
});

describe("blocksOf", () => {
  it("puts reports of the same bug, worded alike, in one block", () => {
    const got = blocksOf([
      t("Pay button does nothing after a declined card"),
      t("Receipt PDF is blank on Firefox"),
      t("Pay does nothing after the card is declined"),
      t("Expired promo codes still give a discount"),
      t("Promo code expired but still gives the discount"),
    ]);
    expect(titles(got)).toEqual([
      ["Pay button does nothing after a declined card", "Pay does nothing after the card is declined"],
      ["Receipt PDF is blank on Firefox"],
      ["Expired promo codes still give a discount", "Promo code expired but still gives the discount"],
    ]);
  });

  it("keeps different bugs on the same page apart", () => {
    const got = blocksOf([t("Typo on the checkout page: Adress"), t("Checkout total ignores the promo code"), t("Checkout address form loses focus")]);
    expect(got).toHaveLength(3);
  });

  it("does not join titles worded too differently, even for the same bug", () => {
    // The review, which reads the reports, is what catches these.
    const got = blocksOf([t("Pay button does nothing after a declined card"), t("Checkout: can't retry payment once the card was refused")]);
    expect(got).toHaveLength(2);
  });

  it("keeps the order: a block sits where its first report was", () => {
    const got = blocksOf([t("Saved cards list empty"), t("Receipt PDF blank Firefox"), t("Saved cards list is empty after adding one")]);
    expect(titles(got)).toEqual([["Saved cards list empty", "Saved cards list is empty after adding one"], ["Receipt PDF blank Firefox"]]);
  });

  it("does not let a block drift through a chain of half-similar titles", () => {
    // B is like A, C is like B but not like A: C starts its own block.
    const got = blocksOf([t("login google loop redirect"), t("login google loop redirect safari timeout"), t("safari timeout upload large file")]);
    expect(got.map((b) => b.length)).toEqual([2, 1]);
  });

  it("leaves untitled reports each on their own", () => {
    expect(blocksOf([t("Untitled"), t("Untitled"), t("")])).toHaveLength(3);
    expect(blocksOf([t(""), t("")])).toHaveLength(2);
  });

  it("is empty for nothing", () => {
    expect(blocksOf([])).toEqual([]);
  });
});
