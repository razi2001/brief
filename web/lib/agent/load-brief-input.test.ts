import { expect, test, vi } from "vitest";

// The transcription models, stubbed: the words, and when each was said.
const tx = vi.hoisted(() => ({
  plain: vi.fn<(input: unknown) => Promise<string | null>>(async () => null),
  timed: vi.fn<(input: unknown) => Promise<Array<{ t: number; text: string }>>>(async () => []),
}));
vi.mock("./transcribe", async (orig) => ({
  ...(await orig<typeof import("./transcribe")>()),
  transcribeAudio: tx.plain,
  transcribeTimed: tx.timed,
}));

import { loadBriefInput } from "./load-brief-input";
import type { BriefStore } from "./brief-store";

/** A store over an in-memory map of storage paths. */
function memoryStore(files: Record<string, Buffer>): BriefStore {
  return {
    async download(p) {
      return files[p] ?? null;
    },
    async list(dir) {
      const names = new Set<string>();
      for (const k of Object.keys(files)) if (k.startsWith(dir + "/")) names.add(k.slice(dir.length + 1).split("/")[0]);
      return [...names];
    },
  };
}
const json = (v: unknown) => Buffer.from(JSON.stringify(v));

test("reads a brief from any store: the json with the reporter's edits, each screenshot with its note", async () => {
  const store = memoryStore({
    "u/b/brief.json": json({ description: "old", pageUrl: "https://app.x/cases", screenshots: [{ file: "screenshots/s1.png", description: "the save button" }] }),
    "u/b/screenshots/s1.png": Buffer.from("png"),
  });
  const { input } = await loadBriefInput(store, "u/b", { overrides: { description: "Save does nothing" } });
  expect(input.json).toMatchObject({ description: "Save does nothing", pageUrl: "https://app.x/cases" });
  expect(input.images.map((i) => [i.name, i.caption])).toEqual([["screenshots/s1.png", "the save button"]]);
  expect(input.evidence.items).toEqual([{ name: "s1.png", kind: "screenshot", caption: "the save button" }]);
});

test("a replay's stills come from the store's replay-frames folder, with their notes", async () => {
  const store = memoryStore({
    "u/b/brief.json": json({}),
    "u/b/replay.json": json({ v: 2, events: [], frames: [{ file: "frame-01.jpg", t: 1000, url: "https://app.x/", note: "Brief noticed: POST /api/pay failed (500)" }], marks: [] }),
    "u/b/replay-frames/frame-01.jpg": Buffer.from("jpg"),
  });
  const { input } = await loadBriefInput(store, "u/b", {});
  expect(input.images.map((i) => i.name)).toEqual(["replay-frame-frame-01.jpg"]);
  expect(input.images[0].caption).toBe("Brief noticed: POST /api/pay failed (500)");
});

test("the narration is timed, but only counted when someone was heard speaking", async () => {
  tx.plain.mockClear();
  tx.timed.mockClear();
  const said = [{ t: 4200, text: "See, it is still the old name." }];
  tx.timed.mockResolvedValue(said);
  const files = { "u/b/brief.json": json({ events: [] }), "u/b/audio.webm": Buffer.from("opus") };

  // the popup's transcript: kept as the words, timing added
  let { input } = await loadBriefInput(memoryStore(files), "u/b", { overrides: { transcript: "see it's still the old name" } });
  expect(input.json).toMatchObject({ transcript: "see it's still the old name", narrationTimed: said });
  expect(tx.plain).not.toHaveBeenCalled();

  // nothing heard by the better model: Whisper's words over silence are dropped
  tx.plain.mockResolvedValueOnce(null);
  ({ input } = await loadBriefInput(memoryStore(files), "u/b", {}));
  expect(input.json).not.toHaveProperty("narrationTimed");
  expect(tx.timed.mock.calls[0][0]).toMatchObject({ filename: "audio.webm" });
});

test("no voice heard in the extension: the recording is not transcribed again (the model invents words for silence)", async () => {
  tx.plain.mockClear();
  tx.timed.mockResolvedValue([]);
  const files = { "u/b/brief.json": json({ events: [] }), "u/b/audio.webm": Buffer.from("opus") };
  const { input } = await loadBriefInput(memoryStore(files), "u/b", { overrides: { transcript: "", noSpeech: true } });
  expect(tx.plain).not.toHaveBeenCalled();
  expect((input.json as { transcript?: string }).transcript ?? "").toBe("");
});

test("a video uploaded from a file keeps no page and no event log", async () => {
  const store = memoryStore({
    "u/b/brief.json": json({
      pageUrl: "https://app.x/stale",
      pageTitle: "Stale",
      recording: { file: "recording.mp4", source: "upload" },
      events: [{ type: "click", tMs: 100, url: "https://app.x/stale", element: { text: "Old" } }],
    }),
  });
  const { input } = await loadBriefInput(store, "u/b", { lean: true });
  const j = input.json as Record<string, unknown>;
  expect(j.pageUrl).toBeUndefined();
  expect(j.pageTitle).toBeUndefined();
  expect(j.events).toEqual([]);
  expect(j.techLogs).toBeUndefined();
});
