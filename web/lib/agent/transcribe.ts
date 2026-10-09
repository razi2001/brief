import OpenAI, { toFile } from "openai";

export interface TranscribeInput {
  bytes: Buffer;
  filename: string;
  contentType: string;
  /**
   * Words the speaker is likely to say (page title, site, the reporter's own
   * text). The model uses it to spell names right; it never ends up in the
   * transcript. See transcriptionHint().
   */
  prompt?: string;
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
    const prompt = input.prompt?.trim();
    const res = await create({ file, model, response_format: "text", ...(prompt ? { prompt } : {}) });
    const text = typeof res === "string" ? res : ((res as { text?: string })?.text ?? "");
    const trimmed = String(text).trim();
    return trimmed || null;
  } catch (err) {
    console.warn("[transcribe] failed:", (err as { message?: string })?.message ?? err);
    return null;
  }
}

const HINT_MAX = 800;

/**
 * The vocabulary of a bug report, as a short hint for transcription: where it
 * happened (page title, site and path words) and what the reporter typed (the
 * description, screenshot notes). Product names, button labels and URLs are
 * what speech models misspell; the reporter usually typed them somewhere.
 * `extra` adds more (a replay's pages and the buttons clicked). Empty when
 * there is nothing to go on.
 */
export function transcriptionHint(brief: unknown, extra: string[] = []): string {
  const j = (brief ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const parts: string[] = [];
  const title = str(j.pageTitle);
  let place = "";
  try {
    const u = new URL(str(j.pageUrl));
    const path = u.pathname.split("/").filter((p) => p && !/^[\da-f-]{8,}$|^\d+$/i.test(p)).join("/");
    place = `${u.hostname}${path ? `/${path}` : ""}`;
  } catch {}
  if (title || place) parts.push(`A bug report on ${title && place ? `${title} (${place})` : title || place}.`);
  const desc = str(j.description);
  if (desc) parts.push(/[.!?]$/.test(desc.slice(0, 300)) ? desc.slice(0, 300) : `${desc.slice(0, 300)}.`);
  const notes = (Array.isArray(j.screenshots) ? j.screenshots : [])
    .map((s) => str((s as { description?: unknown })?.description))
    .filter(Boolean);
  const words = [...new Set([...notes, ...extra.map(str)].filter(Boolean))];
  if (words.length) parts.push(words.join(". ") + ".");
  const out = parts.join(" ");
  return out.length > HINT_MAX ? out.slice(0, HINT_MAX).replace(/\s+\S*$/, "") : out;
}
