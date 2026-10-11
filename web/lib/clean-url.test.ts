import { describe, expect, it } from "vitest";
import { cleanUrl } from "./clean-url";

describe("cleanUrl", () => {
  it("drops analytics parameters, keeps the app's #route", () => {
    const raw =
      "https://app.thunders.ai/?_gl=1*1449qdu*_gcl_au*MTYxMjU1NDI1NS4xNzkxMjc1NDEy*FPAU*MTYx*_ga*MTEw*_ga_NH24SXGNLR*czE3*_fplc*UnIlMk#/test-projects/0ed040a1-86e5-4d70-805f-f6692fa4635e/test-cases";
    expect(cleanUrl(raw)).toBe("https://app.thunders.ai/#/test-projects/0ed040a1-86e5-4d70-805f-f6692fa4635e/test-cases");
  });

  it("keeps the real query and drops only the tracking part", () => {
    expect(cleanUrl("https://shop.test/search?q=shoes&page=2&utm_source=news&gclid=abc")).toBe("https://shop.test/search?q=shoes&page=2");
  });

  it("leaves a clean address exactly as it was", () => {
    const u = "https://a.test/x?id=7#top";
    expect(cleanUrl(u)).toBe(u);
  });

  it("is safe with nothing or a non-URL", () => {
    expect(cleanUrl("")).toBe("");
    expect(cleanUrl(null)).toBeNull();
    expect(cleanUrl("not a url")).toBe("not a url");
  });
});
