import { describe, it, expect } from "vitest";
import { pageAt, pageName, pageTrail, recordingTimeline } from "./timeline";
import type { TechDetails } from "./tech-details";

const td = (over: Partial<TechDetails> = {}): TechDetails => ({ pages: [], network: [], console: [], actions: [], ...over });

describe("pageTrail / pageAt / pageName", () => {
  const pages = [{ t: 0, url: "https://a.x/" }, { t: 5000, url: "https://a.x/b", title: "B" }];

  it("lends the brief's title to the first page at the same address", () => {
    expect(pageTrail(td({ pages }), { url: "https://a.x/", title: "Home" })[0]).toEqual({ t: 0, url: "https://a.x/", title: "Home" });
    expect(pageTrail(td({ pages }), { url: "https://other/", title: "Home" })[0].title).toBeUndefined();
  });

  it("finds the page at a time, and names it with its title when known", () => {
    expect(pageAt(pages, 4999)?.url).toBe("https://a.x/");
    expect(pageAt(pages, 5000)?.url).toBe("https://a.x/b");
    expect(pageName(pages[1])).toBe("B (https://a.x/b)");
    expect(pageName(pages[0])).toBe("https://a.x/");
  });
});

describe("recordingTimeline", () => {
  it("puts pages, actions, failures, speech and marks on one clock", () => {
    const lines = recordingTimeline(
      td({
        pages: [{ t: 0, url: "https://a.x/" }, { t: 3000, url: "https://a.x/settings", title: "Settings" }],
        actions: [
          { t: 2000, kind: "click", what: '"Settings"' },
          { t: 3000, kind: "go to", what: "a.x/settings" },
          { t: 6000, kind: "click", what: '"Save"' },
          { t: 9000, kind: "reload", what: "a.x/settings" },
        ],
        network: [
          { t: 6100, method: "PUT", url: "https://a.x/api/me", status: 500, ms: 300 },
          { t: 6200, method: "GET", url: "https://a.x/api/ok", status: 200, ms: 20 },
          { t: 6300, method: "POST", url: "https://www.google-analytics.com/g/collect", status: 0 },
        ],
        console: [{ t: 6400, level: "error", text: "Save failed" }, { t: 6500, level: "warn", text: "meh" }],
      }),
      { said: [{ t: 7000, text: "Nothing happens." }], marks: [{ t: 7000, note: "here" }], startTitle: "Home", startUrl: "https://a.x/" },
    );
    expect(lines).toEqual([
      "0:00 on Home (https://a.x/)",
      '0:02 clicked "Settings"',
      "0:03 now on Settings (https://a.x/settings)",
      '0:06 clicked "Save"',
      "0:06 call PUT a.x/api/me -> 500 in 300 ms",
      "0:06 console error: Save failed",
      '0:07 says: "Nothing happens."',
      '0:07 MARKED by the reporter: "here"',
      "0:09 reloaded the page",
    ]);
  });

  it("is empty for an empty capture", () => {
    expect(recordingTimeline(td())).toEqual([]);
  });
});
