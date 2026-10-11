import { describe, expect, it, vi } from "vitest";
import { draftJob, holdDraftJob, runDraftJob } from "./draft-jobs";

describe("draft jobs: a draft is written once, whoever starts it", () => {
  it("a second start joins the running write instead of running another", async () => {
    let finish!: () => void;
    const write = vi.fn(() => new Promise<void>((r) => { finish = r; }));
    const a = runDraftJob("b1", write);
    const b = runDraftJob("b1", write);
    await new Promise((r) => setTimeout(r, 0)); // the write starts on the next tick
    expect(write).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(draftJob("b1")).toBeDefined();
    finish();
    await a;
    expect(draftJob("b1")).toBeUndefined();
  });

  it("an inline write (the live stream) holds off a background one until it's done", async () => {
    const release = holdDraftJob("b2");
    const write = vi.fn(async () => {});
    const joined = runDraftJob("b2", write);
    expect(write).not.toHaveBeenCalled();
    release();
    await joined;
    expect(draftJob("b2")).toBeUndefined();
  });

  it("a failed write doesn't stay marked as running", async () => {
    await runDraftJob("b3", async () => { throw new Error("model down"); });
    expect(draftJob("b3")).toBeUndefined();
  });
});
