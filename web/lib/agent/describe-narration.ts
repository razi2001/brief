import OpenAI from "openai";
import { chatParams, fastModel } from "./model";

/**
 * The reporter talked over their recording; this turns what they said into the
 * text they would have typed in the popup's description field, so they only
 * have to check it. The filing agent still gets the full transcript.
 */
export const DESCRIBE_SYSTEM = `You write the description field of a bug report from the reporter's spoken narration.

The narration is a speech-to-text transcript of someone talking while they screen-record a problem or a request. Write what they would have typed:
- 1 to 3 short sentences of plain text.
- First what is wrong (or what they want) and where. Then what they expected, only if they said it.
- Use the language they spoke. Keep names, button labels and values exactly as said. Write spoken URLs and paths the way they are typed (example.com/a/b, not "example.com slash a slash b").
- Drop filler, false starts and repetition. Add nothing they did not say: no guesses, no causes, no severity.
- No markdown, no quotes, no headings, no dashes. Do not start with "The user".
If the narration says nothing about a problem or a request (silence, filler, a mic test), answer exactly: NONE`;

const TRANSCRIPT_MAX = 8000;
const DESCRIPTION_MAX = 600;

/** Tidy the model's answer into field text. "" when there is nothing to use. */
export function cleanDescription(raw: string): string {
  let s = String(raw ?? "").trim();
  if (/^none\.?$/i.test(s)) return "";
  s = s
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\*\*|__/g, "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
  // Quotes wrapped around the whole answer, not ones around a label inside it.
  const wrapped = /^(["“])([^"“”]*)(["”])$/.exec(s);
  if (wrapped) s = wrapped[2].trim();
  if (s.length > DESCRIPTION_MAX) s = s.slice(0, DESCRIPTION_MAX).replace(/\s+\S*$/, "");
  return s;
}

export interface DescribeDeps {
  /** Injectable for tests; defaults to a real chat completion. */
  create?: (args: Record<string, unknown>) => Promise<unknown>;
  /** Override the model; defaults to fastModel(). */
  model?: string;
}

/**
 * Fail-soft by contract: the description, or null for an empty transcript, a
 * NONE answer, or ANY error. A missing description must never fail the call
 * that carries the transcript.
 */
export async function describeNarration(transcript: string, deps: DescribeDeps = {}): Promise<string | null> {
  const said = String(transcript ?? "").trim().slice(0, TRANSCRIPT_MAX);
  if (!said) return null;
  const model = deps.model || fastModel();
  const client = deps.create ? null : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const create: (args: Record<string, unknown>) => Promise<unknown> =
    deps.create ||
    ((args) => {
      const c = client!;
      return c.chat.completions.create(args as unknown as Parameters<typeof c.chat.completions.create>[0]);
    });
  try {
    const res = (await create({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: DESCRIBE_SYSTEM },
        { role: "user", content: `Narration:\n"""\n${said}\n"""` },
      ],
      ...chatParams(model),
    })) as { choices?: Array<{ message?: { content?: string | null } }> };
    return cleanDescription(res?.choices?.[0]?.message?.content ?? "") || null;
  } catch (err) {
    console.warn("[describe-narration] failed:", (err as { message?: string })?.message ?? err);
    return null;
  }
}
