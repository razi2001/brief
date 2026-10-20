import { describe, expect, it } from "vitest";
import { deviceOf, isBot, parseSiteEvent } from "./site-events";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const ok = { origin: "https://get-brief.app", ua: CHROME, dev: false };

describe("parseSiteEvent", () => {
  it("keeps the known fields of a known event and adds the device", () => {
    const raw = JSON.stringify({ name: "site.view", props: { path: "/", ref: "linkedin.com", pv: "abc", junk: "x" } });
    expect(parseSiteEvent(raw, ok)).toEqual({
      name: "site.view",
      props: { path: "/", ref: "linkedin.com", pv: "abc", device: "desktop" },
    });
  });

  it("refuses other origins, unknown names, bots, big bodies and bad JSON", () => {
    const raw = JSON.stringify({ name: "site.click", props: { target: "signup" } });
    expect(parseSiteEvent(raw, { ...ok, origin: "https://evil.example" })).toBeNull();
    expect(parseSiteEvent(raw, { ...ok, origin: null })).toBeNull();
    expect(parseSiteEvent(JSON.stringify({ name: "brief.filed" }), ok)).toBeNull();
    expect(parseSiteEvent(JSON.stringify({ name: "constructor" }), ok)).toBeNull();
    expect(parseSiteEvent(raw, { ...ok, ua: "Googlebot/2.1" })).toBeNull();
    expect(parseSiteEvent("x".repeat(3000), ok)).toBeNull();
    expect(parseSiteEvent("{", ok)).toBeNull();
  });

  it("accepts www and, in development only, localhost", () => {
    const raw = JSON.stringify({ name: "site.demo", props: { act: "start" } });
    expect(parseSiteEvent(raw, { ...ok, origin: "https://www.get-brief.app" })).not.toBeNull();
    expect(parseSiteEvent(raw, { ...ok, origin: "http://localhost:8080" })).toBeNull();
    expect(parseSiteEvent(raw, { ...ok, origin: "http://localhost:8080", dev: true })).not.toBeNull();
  });
});

describe("isBot / deviceOf", () => {
  it("spots bots and empty agents", () => {
    expect(isBot("")).toBe(true);
    expect(isBot("Mozilla/5.0 HeadlessChrome/141")).toBe(true);
    expect(isBot(CHROME)).toBe(false);
  });

  it("tells mobile from desktop", () => {
    expect(deviceOf(IPHONE)).toBe("mobile");
    expect(deviceOf(CHROME)).toBe("desktop");
  });
});
