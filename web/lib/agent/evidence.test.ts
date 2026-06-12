import { describe, it, expect } from "vitest";
import { buildEvidenceManifest, pickEvidence, type EvidenceItem } from "./evidence";

const items: EvidenceItem[] = [
  { name: "keyframe-000.png", kind: "keyframe", timestampMs: 0 },
  { name: "keyframe-004.png", kind: "keyframe", timestampMs: 8200 },
  { name: "screenshot.png", kind: "screenshot" },
  { name: "recording.webm", kind: "recording" },
];

describe("pickEvidence", () => {
  const attachable = items.map((i) => i.name);
  const fallback = ["screenshot.png"];

  it("returns the agent's valid selection", () => {
    expect(pickEvidence(["keyframe-000.png", "screenshot.png"], attachable, fallback)).toEqual([
      "keyframe-000.png",
      "screenshot.png",
    ]);
  });

  it("drops names that are not attachable (e.g. the excluded recording)", () => {
    const noVideo = attachable.filter((n) => n !== "recording.webm");
    expect(pickEvidence(["recording.webm", "screenshot.png"], noVideo, fallback)).toEqual([
      "screenshot.png",
    ]);
  });

  it("falls back when the agent picked nothing valid", () => {
    expect(pickEvidence(["bogus.png"], attachable, fallback)).toEqual(fallback);
    expect(pickEvidence(undefined, attachable, fallback)).toEqual(fallback);
    expect(pickEvidence([], attachable, fallback)).toEqual(fallback);
  });

  it("de-dupes the selection", () => {
    expect(pickEvidence(["screenshot.png", "screenshot.png"], attachable, fallback)).toEqual([
      "screenshot.png",
    ]);
  });
});

describe("buildEvidenceManifest", () => {
  it("lists each attachable file with kind and timestamp", () => {
    const text = buildEvidenceManifest(items, false);
    expect(text).toContain("keyframe-004.png");
    expect(text).toContain("0:08");
    expect(text).toContain("screenshot.png");
  });

  it("excludes the recording and says why when the user opted out", () => {
    const text = buildEvidenceManifest(items, false);
    expect(text).not.toMatch(/^- recording\.webm/m);
    expect(text.toLowerCase()).toContain("chose not to attach");
  });

  it("lists the recording when the user opted in", () => {
    const text = buildEvidenceManifest(items, true);
    expect(text).toContain("recording.webm");
    expect(text.toLowerCase()).not.toContain("chose not to attach");
  });

  it("returns empty for no evidence", () => {
    expect(buildEvidenceManifest([], true)).toBe("");
  });
});
