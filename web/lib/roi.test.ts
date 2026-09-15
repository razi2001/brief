import { describe, it, expect } from "vitest";
import { summarizeRoi, MINUTES_BY_HAND } from "./roi";

describe("summarizeRoi", () => {
  it("counts the tickets and the ones that carried evidence", () => {
    const r = summarizeRoi({ filed: 80, withEvidence: 78, avgSeconds: 42 });
    expect(r?.filed).toBe(80);
    expect(r?.withEvidence).toBe(78);
  });

  it("credits the writing time saved, net of what capture actually cost", () => {
    // 80 x 15 min by hand = 1200 min; capture really took 80 x 42s = 56 min.
    const r = summarizeRoi({ filed: 80, withEvidence: 78, avgSeconds: 42 });
    expect(r?.hoursSaved).toBe(19);
  });

  it("never counts the capture time as free", () => {
    const gross = (10 * MINUTES_BY_HAND) / 60;
    const r = summarizeRoi({ filed: 10, withEvidence: 10, avgSeconds: 120 });
    expect(r!.hoursSaved).toBeLessThan(gross);
  });

  it("rounds to whole hours - a dashboard headline is not a stopwatch", () => {
    const r = summarizeRoi({ filed: 7, withEvidence: 7, avgSeconds: 40 });
    expect(Number.isInteger(r!.hoursSaved)).toBe(true);
  });

  it("reports capture time in seconds while it is under a minute", () => {
    const r = summarizeRoi({ filed: 80, withEvidence: 78, avgSeconds: 42 });
    expect(r?.capture).toBe("42 seconds");
  });

  it("switches to minutes once capture takes longer than that", () => {
    const r = summarizeRoi({ filed: 80, withEvidence: 78, avgSeconds: 150 });
    expect(r?.capture).toBe("2.5 minutes");
  });

  it("says nothing at all when nothing has been filed", () => {
    // A headline claiming a saving on zero tickets is just noise.
    expect(summarizeRoi({ filed: 0, withEvidence: 0, avgSeconds: 0 })).toBeNull();
  });

  it("stays quiet until the saving is worth a sentence", () => {
    // One ticket is 15 minutes. Rounding that to "0 hours saved" reads as a bug.
    expect(summarizeRoi({ filed: 1, withEvidence: 1, avgSeconds: 42 })).toBeNull();
  });

  it("holds up when capture time is missing", () => {
    const r = summarizeRoi({ filed: 40, withEvidence: 30, avgSeconds: 0 });
    expect(r?.hoursSaved).toBe(10);
    expect(r?.capture).toBeNull();
  });

  it("never claims more evidence than there are tickets", () => {
    const r = summarizeRoi({ filed: 5, withEvidence: 99, avgSeconds: 42 });
    expect(r?.withEvidence).toBe(5);
  });

  it("states the assumption it is built on, so it can be checked", () => {
    const r = summarizeRoi({ filed: 80, withEvidence: 78, avgSeconds: 42 });
    expect(r?.basis).toContain(String(MINUTES_BY_HAND));
  });
});
