import type OpenAI from "openai";
import type {
  FunctionTool,
  ResponseFunctionToolCall,
  ResponseInputContent,
  ResponseInputItem,
  ResponseStreamEvent,
  ResponseUsage,
} from "openai/resources/responses/responses";
import { errorMessage } from "@/lib/errors";
import { responsesParams } from "./model";

// The ticket writers talk to OpenAI through /v1/responses: gpt-5.6 takes
// function tools there WITH reasoning (chat completions refuses the two
// together). Nothing is stored at OpenAI (store:false), so a tool loop carries
// the model's encrypted reasoning from turn to turn itself.

/** One part of the user's message: text, or an image as a data URL. */
export type Part = ResponseInputContent;
export const text = (t: string): Part => ({ type: "input_text", text: t });
export const image = (url: string): Part => ({ type: "input_image", image_url: url, detail: "auto" });

/** A function the model may call: JSON-schema parameters, as in chat completions. */
export type FunctionDef = { name: string; description?: string; parameters: Record<string, unknown> };
export type Usage = { input: number; output: number; reasoning: number };

const toTools = (defs: FunctionDef[]): FunctionTool[] =>
  defs.map((d) => ({ type: "function", name: d.name, description: d.description ?? null, parameters: d.parameters, strict: false }));

const usageOf = (u?: ResponseUsage | null): Usage | undefined =>
  u ? { input: u.input_tokens, output: u.output_tokens, reasoning: u.output_tokens_details?.reasoning_tokens ?? 0 } : undefined;

/**
 * Runs the model with tools until it answers without calling one (or maxTurns).
 * Every turn's output (reasoning, text, calls) goes back as input with each
 * call's result; a tool that throws answers the model with { error }. A turn
 * whose request fails throws, unless onTurnError returns true (stop quietly).
 * Returns the model's last text.
 */
export async function runToolLoop(opts: {
  client: OpenAI;
  model: string;
  instructions: string;
  content: Part[];
  tools: FunctionDef[];
  maxTurns: number;
  onCall: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  onTurnError?: (e: unknown) => boolean;
}): Promise<string> {
  const input: ResponseInputItem[] = [{ role: "user", content: opts.content }];
  const tools = toTools(opts.tools);
  for (let turn = 0; turn < opts.maxTurns; turn++) {
    let resp;
    try {
      resp = await opts.client.responses.create({
        model: opts.model,
        instructions: opts.instructions,
        input: [...input],
        tools,
        store: false,
        ...responsesParams(opts.model),
      });
    } catch (e) {
      if (opts.onTurnError?.(e)) return "";
      throw e;
    }
    input.push(...(resp.output as ResponseInputItem[]));
    const calls = resp.output.filter((o): o is ResponseFunctionToolCall => o.type === "function_call");
    if (!calls.length) return resp.output_text ?? "";
    for (const c of calls) {
      let result: unknown;
      try {
        result = await opts.onCall(c.name, c.arguments ? JSON.parse(c.arguments) : {});
      } catch (e) {
        result = { error: errorMessage(e) };
      }
      input.push({ type: "function_call_output", call_id: c.call_id, output: JSON.stringify(result ?? null) });
    }
  }
  return "";
}

/** One answer as JSON matching `schema` (strict structured output). */
export async function respondJson<T>(opts: {
  client: OpenAI;
  model: string;
  instructions: string;
  content: Part[];
  name: string;
  schema: Record<string, unknown>;
}): Promise<{ value: T; usage?: Usage }> {
  const resp = await opts.client.responses.create({
    model: opts.model,
    instructions: opts.instructions,
    input: [{ role: "user", content: opts.content }],
    text: { format: { type: "json_schema", name: opts.name, schema: opts.schema, strict: true } },
    store: false,
    ...responsesParams(opts.model),
  });
  return { value: JSON.parse(resp.output_text) as T, usage: usageOf(resp.usage) };
}

/** The answer's text as it is written. */
export async function* streamText(opts: {
  client: OpenAI;
  model: string;
  instructions: string;
  content: Part[];
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const stream = await opts.client.responses.create(
    {
      model: opts.model,
      instructions: opts.instructions,
      input: [{ role: "user", content: opts.content }],
      stream: true,
      store: false,
      ...responsesParams(opts.model),
    },
    { signal: opts.signal },
  );
  for await (const ev of stream as AsyncIterable<ResponseStreamEvent>) {
    if (ev.type === "response.output_text.delta") yield ev.delta;
  }
}
