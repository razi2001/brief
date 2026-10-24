import { describe, it, expect, vi } from "vitest";
import { saidLines, transcribeAudio, transcribeTimed, transcriptionHint } from "./transcribe";

const audio = () => ({ bytes: Buffer.from("fake-opus-bytes"), filename: "audio.webm", contentType: "audio/webm" });

describe("transcribeAudio", () => {
  it("returns null when there is no audio", async () => {
    expect(await transcribeAudio(null)).toBe(null);
  });

  it("returns null for empty bytes", async () => {
    expect(await transcribeAudio({ bytes: Buffer.alloc(0), filename: "audio.webm", contentType: "audio/webm" })).toBe(null);
  });

  it("returns trimmed text when the API returns a string", async () => {
    const create = vi.fn().mockResolvedValue("  hello world  ");
    expect(await transcribeAudio(audio(), { create })).toBe("hello world");
    expect(create).toHaveBeenCalledOnce();
  });

  it("returns text when the API returns an object with .text", async () => {
    const create = vi.fn().mockResolvedValue({ text: "from object" });
    expect(await transcribeAudio(audio(), { create })).toBe("from object");
  });

  it("returns null (never throws) when the API errors", async () => {
    const create = vi.fn().mockRejectedValue(new Error("boom"));
    expect(await transcribeAudio(audio(), { create })).toBe(null);
  });

  it("returns null when the API returns only whitespace", async () => {
    const create = vi.fn().mockResolvedValue("   ");
    expect(await transcribeAudio(audio(), { create })).toBe(null);
  });

  it("passes the configured model through to the API", async () => {
    const create = vi.fn().mockResolvedValue("ok");
    await transcribeAudio(audio(), { create, model: "gpt-4o-transcribe" });
    expect(create.mock.calls[0][0]).toMatchObject({ model: "gpt-4o-transcribe", response_format: "text" });
  });

  it("sends the hint as the prompt, and no prompt when there is none", async () => {
    const create = vi.fn().mockResolvedValue("ok");
    await transcribeAudio({ ...audio(), prompt: "  Checkout on app.thunders.ai  " }, { create });
    await transcribeAudio({ ...audio(), prompt: "   " }, { create });
    expect(create.mock.calls[0][0]).toMatchObject({ prompt: "Checkout on app.thunders.ai" });
    expect(create.mock.calls[1][0]).not.toHaveProperty("prompt");
  });
});

describe("transcriptionHint", () => {
  it("names the page and site, keeps readable path words, drops ids", () => {
    const h = transcriptionHint({
      pageTitle: "Billing - Thunders",
      pageUrl: "https://app.thunders.ai/org/3f2a9c1e-77aa-4c3b-9d5e-0a1b2c3d4e5f/billing/12345?tab=invoices",
    });
    expect(h).toBe("A bug report on Billing - Thunders (app.thunders.ai/org/billing).");
  });

  it("adds what the reporter typed: the description and screenshot notes, then extras", () => {
    const h = transcriptionHint(
      {
        pageUrl: "https://app.thunders.ai/",
        description: "Pay now   does nothing",
        screenshots: [{ description: "Valider button" }, { description: "" }, {}],
      },
      ["Clicked Pay now", "Valider button"],
    );
    expect(h).toBe("A bug report on app.thunders.ai. Pay now does nothing. Valider button. Clicked Pay now.");
  });

  it("is empty with nothing to go on, and survives junk", () => {
    expect(transcriptionHint({})).toBe("");
    expect(transcriptionHint(null)).toBe("");
    expect(transcriptionHint({ pageUrl: "not a url", screenshots: "nope", description: 42 })).toBe("");
  });

  it("stays short, cut on a word", () => {
    const h = transcriptionHint({ description: "word ".repeat(100) }, ["label ".repeat(200)]);
    expect(h.length).toBeLessThanOrEqual(800);
    expect(h.endsWith("label") || h.endsWith("word")).toBe(true);
  });
});

describe("saidLines", () => {
  const w = (word: string, start: number) => ({ word, start, end: start + 0.2 });

  it("gives each sentence the time of its first word, even mid-segment", () => {
    const res = {
      segments: [
        { start: 0, text: " I go to settings. I click save." },
        { start: 4, text: " See, it is still the old name." },
      ],
      words: [w("I", 0.2), w("go", 0.4), w("to", 0.5), w("settings", 0.7), w("I", 2.1), w("click", 2.3), w("save", 2.6),
        w("See", 4.5), w("it", 4.9), w("is", 5), w("still", 5.2), w("the", 5.4), w("old", 5.5), w("name", 5.7)],
    };
    expect(saidLines(res)).toEqual([
      { t: 200, text: "I go to settings." },
      { t: 2100, text: "I click save." },
      { t: 4500, text: "See, it is still the old name." },
    ]);
  });

  it("joins a sentence a segment cut in two", () => {
    const res = {
      segments: [{ start: 0, text: " The name up here is" }, { start: 3, text: " still the old one. Weird." }],
      words: [w("The", 0.1), w("name", 0.3), w("up", 0.5), w("here", 0.6), w("is", 0.8), w("still", 3.1), w("the", 3.3), w("old", 3.4), w("one", 3.6), w("Weird", 4.2)],
    };
    expect(saidLines(res)).toEqual([
      { t: 100, text: "The name up here is still the old one." },
      { t: 4200, text: "Weird." },
    ]);
  });

  it("falls back to the segment's start without word times, and ignores junk", () => {
    expect(saidLines({ segments: [{ start: 1.5, text: "Hello there." }, { start: "x", text: "no" }, { start: 3 }] })).toEqual([
      { t: 1500, text: "Hello there." },
    ]);
    expect(saidLines(null)).toEqual([]);
  });
});

describe("transcribeTimed", () => {
  it("asks Whisper for word and segment times and returns sentences", async () => {
    const create = vi.fn().mockResolvedValue({ segments: [{ start: 0.5, text: "Nothing happens." }], words: [{ word: "Nothing", start: 0.6 }] });
    expect(await transcribeTimed({ ...audio(), prompt: "Settings" }, { create })).toEqual([{ t: 600, text: "Nothing happens." }]);
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word", "segment"],
      prompt: "Settings",
    });
  });

  it("returns [] (never throws) on a failure or no audio", async () => {
    expect(await transcribeTimed(audio(), { create: vi.fn().mockRejectedValue(new Error("boom")) })).toEqual([]);
    expect(await transcribeTimed(null)).toEqual([]);
  });
});
