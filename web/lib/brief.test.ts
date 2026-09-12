import { describe, it, expect } from "vitest";
import { detectSourceKind, isRecordingName, recordingContentType, findRecordingName, isTranscribableRecording } from "./brief";

describe("detectSourceKind", () => {
  it("recording when keyframes/transcript present", () => {
    expect(detectSourceKind({ transcript: "hi", keyframeCount: 12 })).toBe("recording");
  });
  it("screenshot when only screenshot", () => {
    expect(detectSourceKind({ hasScreenshot: true })).toBe("screenshot");
  });
  it("text when only description", () => {
    expect(detectSourceKind({ description: "button broken" })).toBe("text");
  });
  it("mix when recording + screenshot", () => {
    expect(detectSourceKind({ keyframeCount: 5, hasScreenshot: true })).toBe("mix");
  });
});

describe("recording file names", () => {
  it("recognizes only the three recording containers", () => {
    expect(isRecordingName("recording.webm")).toBe(true);
    expect(isRecordingName("recording.mp4")).toBe(true);
    expect(isRecordingName("recording.mov")).toBe(true);
    expect(isRecordingName("recording.avi")).toBe(false);
    expect(isRecordingName("screenshot.png")).toBe(false);
    expect(isRecordingName(undefined)).toBe(false);
  });
  it("maps each name to its content type", () => {
    expect(recordingContentType("recording.webm")).toBe("video/webm");
    expect(recordingContentType("recording.mp4")).toBe("video/mp4");
    expect(recordingContentType("recording.mov")).toBe("video/quicktime");
  });
  it("finds the recording among root objects, webm first", () => {
    expect(findRecordingName(["brief.json", "recording.mp4"])).toBe("recording.mp4");
    expect(findRecordingName(["recording.mp4", "recording.webm"])).toBe("recording.webm");
    expect(findRecordingName(["brief.json", "screenshot.png"])).toBe(null);
    expect(findRecordingName(new Set(["recording.mov"]))).toBe("recording.mov");
  });
  it("only webm and mp4 go to transcription", () => {
    expect(isTranscribableRecording("recording.webm")).toBe(true);
    expect(isTranscribableRecording("recording.mp4")).toBe(true);
    expect(isTranscribableRecording("recording.mov")).toBe(false);
  });
});
