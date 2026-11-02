import { describe, expect, it } from "vitest";
import { BRIEF_TICKETS, NO_REFERRER, channelOf, signupChannel } from "./channels";

describe("channelOf", () => {
  it("folds a place's hosts and app ids into one name", () => {
    expect(channelOf("www.linkedin.com")).toBe("LinkedIn");
    expect(channelOf("com.linkedin.android")).toBe("LinkedIn");
    expect(channelOf("lnkd.in")).toBe("LinkedIn");
    expect(channelOf("teams.public.onecdn.static.microsoft")).toBe("Microsoft Teams");
    expect(channelOf("www.google.com")).toBe("Google");
    expect(channelOf("www.google.fr")).toBe("Google");
    expect(channelOf("chromewebstore.google.com")).toBe("Chrome Web Store");
    expect(channelOf("club.ministryoftesting.com")).toBe("Ministry of Testing");
    expect(channelOf("acme.atlassian.net")).toBe(BRIEF_TICKETS);
  });

  it("says when there was no referrer, and keeps unknown hosts readable", () => {
    expect(channelOf("")).toBe(NO_REFERRER);
    expect(channelOf(undefined)).toBe(NO_REFERRER);
    expect(channelOf("www.example.org")).toBe("example.org");
  });

  it("lets the utm tag win over the host", () => {
    expect(channelOf("", "ticket")).toBe(BRIEF_TICKETS);
    expect(channelOf("www.google.com", "linkedin")).toBe("LinkedIn");
    expect(channelOf("", "Spring launch")).toBe("Spring launch");
  });
});

describe("signupChannel", () => {
  it("reads a tagged sign-up link, null when there was none", () => {
    expect(signupChannel({ src: "hero", ref: "com.linkedin.android" })).toBe("LinkedIn");
    expect(signupChannel({ src: "hero" })).toBe(NO_REFERRER);
    expect(signupChannel({ src: "nav", utm_source: "ticket" })).toBe(BRIEF_TICKETS);
    expect(signupChannel(null)).toBeNull();
  });
});
