import { describe, it, expect } from "vitest";
import { normalizeSitePattern, cleanSiteList, siteMatches, mergeSiteLists, MAX_REPLAY_SITES } from "./replay-sites";

describe("normalizeSitePattern", () => {
  it("accepts hosts, ports and wildcards; reduces URLs to their host", () => {
    expect(normalizeSitePattern("*.Thunders.ai")).toBe("*.thunders.ai");
    expect(normalizeSitePattern("https://Staging.Thunders.ai/x?y")).toBe("staging.thunders.ai");
    expect(normalizeSitePattern("localhost:3000")).toBe("localhost:3000");
    expect(normalizeSitePattern("  app.thunders.ai ")).toBe("app.thunders.ai");
  });
  it("rejects junk and over-broad wildcards", () => {
    for (const bad of ["", "bad host!", "*.com", "*.", "a..b", null, 42]) expect(normalizeSitePattern(bad)).toBeNull();
  });
  it("checks it is a real host: labels, TLD, IP, port", () => {
    for (const ok of ["acme.com", "app.acme.co.uk", "xn--bcher-kva.example", "10.0.0.2:8080", "intranet", "a-b.acme.io:65535"]) {
      expect(normalizeSitePattern(ok)).toBe(ok);
    }
    for (const bad of ["-acme.com", "acme-.com", "acme.c", "acme.123", "999.1.1.1", "acme.com:0", "acme.com:70000", "acme.com:", "*.localhost", "*.10.0.0.2", "a_b.com", "acme..com", `${"a".repeat(64)}.com`]) {
      expect(normalizeSitePattern(bad)).toBeNull();
    }
  });
});

describe("cleanSiteList", () => {
  it("normalizes, de-duplicates, drops junk, caps", () => {
    expect(cleanSiteList(["*.thunders.ai", "*.THUNDERS.ai", "nope nope", "app.x.io"])).toEqual(["*.thunders.ai", "app.x.io"]);
    expect(cleanSiteList("not a list")).toEqual([]);
    const many = Array.from({ length: 80 }, (_, i) => `s${i}.example.com`);
    expect(cleanSiteList(many)).toHaveLength(MAX_REPLAY_SITES);
  });
});

describe("siteMatches", () => {
  it("wildcard covers the apex and subdomains, not lookalikes", () => {
    expect(siteMatches("*.thunders.ai", "https://thunders.ai/")).toBe(true);
    expect(siteMatches("*.thunders.ai", "https://a.b.thunders.ai/x")).toBe(true);
    expect(siteMatches("*.thunders.ai", "https://evilthunders.ai/")).toBe(false);
  });
  it("ports: exact when given, any when not; http(s) only", () => {
    expect(siteMatches("localhost:3000", "http://localhost:3000/")).toBe(true);
    expect(siteMatches("localhost:3000", "http://localhost:3001/")).toBe(false);
    expect(siteMatches("app.thunders.ai", "https://app.thunders.ai:444/")).toBe(true);
    expect(siteMatches("app.thunders.ai", "chrome://app.thunders.ai/")).toBe(false);
  });
});

describe("mergeSiteLists", () => {
  it("is the team's sites plus your own, once each, team first", () => {
    expect(mergeSiteLists(["*.thunders.ai", "app.x.io"], ["localhost:3000", "app.x.io"])).toEqual(["*.thunders.ai", "app.x.io", "localhost:3000"]);
    expect(mergeSiteLists([], ["mine.dev"])).toEqual(["mine.dev"]);
    expect(mergeSiteLists([], [])).toEqual([]);
  });
});
