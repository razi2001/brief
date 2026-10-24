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

/** One thing the reporter said, `t` ms into the audio. */
export type SaidLine = { t: number; text: string };

type WhisperWord = { word?: unknown; start?: unknown };
type WhisperSegment = { start?: unknown; text?: unknown; no_speech_prob?: unknown; avg_logprob?: unknown };

/**
 * Whisper's segments (~6 s each, cut anywhere) re-cut into sentences, each at
 * the time its first word was said. A segment's words are counted off against
 * its text, so a sentence that starts mid-segment gets its own time. Pure.
 */
export function saidLines(res: { segments?: WhisperSegment[]; words?: WhisperWord[] } | null | undefined): SaidLine[] {
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : undefined);
  const words = (Array.isArray(res?.words) ? res.words : [])
    .map((w) => ({ start: num(w?.start), word: typeof w?.word === "string" ? w.word : "" }))
    .filter((w): w is { start: number; word: string } => w.start != null && !!w.word.trim());
  const out: SaidLine[] = [];
  let wi = 0;
  for (const seg of Array.isArray(res?.segments) ? res.segments : []) {
    const start = num(seg?.start);
    const segText = typeof seg?.text === "string" ? seg.text.replace(/\s+/g, " ").trim() : "";
    if (start == null || !segText) continue;
    // Whisper's own test for a stretch of silence it filled with words anyway
    if ((num(seg?.no_speech_prob) ?? 0) > 0.6 && (num(seg?.avg_logprob) ?? 0) < -1) continue;
    // this segment's words: the ones said from its start on
    while (wi < words.length && words[wi].start < start - 0.3) wi++;
    let k = wi;
    // a sentence ends at . ! ? or … (the next one starts after the space)
    for (const sentence of segText.split(/(?<=[.!?…])\s+/)) {
      const s = sentence.trim();
      if (!s) continue;
      const at = words[k]?.start ?? start;
      // continue a sentence the previous segment cut off mid-way
      const prev = out[out.length - 1];
      if (prev && !/[.!?…]$/.test(prev.text)) prev.text = `${prev.text} ${s}`;
      else out.push({ t: Math.round(Math.max(at, 0) * 1000), text: s });
      k += s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    }
    wi = Math.max(wi, k);
  }
  return out;
}

/**
 * When the reporter said what, sentence by sentence (see saidLines), from
 * Whisper's word and segment timestamps - the only transcription model that
 * gives them quickly. The words themselves come from transcribeAudio (a better
 * model, and what the reporter may have corrected in the popup); this is only
 * for lining the narration up with the video. Fail-soft: [] on any error.
 */
export async function transcribeTimed(input: TranscribeInput | null, deps: TranscribeDeps = {}): Promise<SaidLine[]> {
  if (!input || !input.bytes || input.bytes.length === 0) return [];
  const model = deps.model || process.env.TRANSCRIBE_TIMED_MODEL || "whisper-1";
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
    const res = await create({
      file,
      model,
      response_format: "verbose_json",
      timestamp_granularities: ["word", "segment"],
      ...(prompt ? { prompt } : {}),
    });
    return saidLines(res as { segments?: WhisperSegment[]; words?: WhisperWord[] });
  } catch (err) {
    console.warn("[transcribe] timed failed:", (err as { message?: string })?.message ?? err);
    return [];
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
