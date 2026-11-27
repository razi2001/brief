import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixWebmDuration, webmLastTimestamp } from "./webm-duration";

// A real Chrome MediaRecorder file (VP9, 64x48, ~2.5 s): the Segment and its
// Clusters have unknown sizes and Info has no Duration - the shape that left
// recordings on Linear tickets unseekable.
const raw = readFileSync(join(__dirname, "__fixtures__", "mediarecorder.webm"));

/** Reads the Duration float out of Info, or null when there is none. */
function durationOf(b: Buffer): number | null {
  const at = b.indexOf(Buffer.from([0x44, 0x89, 0x88]));
  return at < 0 ? null : b.readDoubleBE(at + 3);
}

describe("fixWebmDuration", () => {
  it("writes the last block's timestamp as the Duration", () => {
    expect(durationOf(raw)).toBeNull();
    const last = webmLastTimestamp(raw)!;
    expect(last).toBeGreaterThan(2000);
    expect(last).toBeLessThan(3500);

    const fixed = fixWebmDuration(raw);
    expect(durationOf(fixed)).toBe(last);
    // The Info grew by the Duration element and a wider size field - nothing else moved.
    expect(fixed.length - raw.length).toBeLessThan(32);
    expect(fixed.subarray(fixed.length - 1000).equals(raw.subarray(raw.length - 1000))).toBe(true);
  });

  it("is a no-op on a file that already has a Duration", () => {
    const fixed = fixWebmDuration(raw);
    expect(fixWebmDuration(fixed)).toBe(fixed);
  });

  it("leaves anything that isn't a WebM untouched", () => {
    const mp4 = Buffer.from("0000001866747970697736d", "hex");
    expect(fixWebmDuration(mp4)).toBe(mp4);
    expect(fixWebmDuration(Buffer.alloc(0)).length).toBe(0);
  });

  it("never throws on a truncated file", () => {
    for (const n of [5, 40, 200, raw.length - 7]) {
      expect(() => fixWebmDuration(raw.subarray(0, n))).not.toThrow();
    }
  });
});
