import { expect, test } from "vitest";
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
