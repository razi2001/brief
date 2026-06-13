import { describe, it, expect, vi } from "vitest";
import { transcribeAudio } from "./transcribe";

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
    expect(create.mock.calls[0][0]).toMatchObject({ model: "gpt-4o-transcribe" });
  });
});
