import OpenAI, { toFile } from "openai";

export interface TranscribeInput {
  bytes: Buffer;
  filename: string;
  contentType: string;
}

export interface TranscribeDeps {
  /** Injectable for tests; defaults to a real OpenAI transcription call. */
  create?: (args: Record<string, unknown>) => Promise<unknown>;
  /** Override the model; defaults to TRANSCRIBE_MODEL env or gpt-4o-transcribe. */
  model?: string;
}

/**
 * Transcribe an audio clip with OpenAI. Fail-soft by contract: returns the
 * trimmed transcript, or null for missing/empty audio, empty results, or ANY
 * error. Callers must never let a transcription failure fail the brief.
 */
export async function transcribeAudio(
  input: TranscribeInput | null,
  deps: TranscribeDeps = {},
): Promise<string | null> {
  if (!input || !input.bytes || input.bytes.length === 0) return null;
  const model = deps.model || process.env.TRANSCRIBE_MODEL || "gpt-4o-transcribe";
  const client = deps.create ? null : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const create: (args: Record<string, unknown>) => Promise<unknown> =
    deps.create ||
    ((args) => {
      const c = client!;
      return c.audio.transcriptions.create(
        args as unknown as Parameters<typeof c.audio.transcriptions.create>[0],
      );
    });
  try {
    const file = await toFile(input.bytes, input.filename, { type: input.contentType });
    const res = await create({ file, model, response_format: "text" });
    const text = typeof res === "string" ? res : ((res as { text?: string })?.text ?? "");
    const trimmed = String(text).trim();
    return trimmed || null;
  } catch (err) {
    console.warn("[transcribe] failed:", (err as { message?: string })?.message ?? err);
    return null;
  }
}
