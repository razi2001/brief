import { expect, test, vi } from "vitest";
import { respondJson, runToolLoop, streamText, text } from "./responses";

const clientWith = (create: ReturnType<typeof vi.fn>) => ({ responses: { create } }) as never;
const call = (name: string, args: object, id = "c1") => ({ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) });
const tools = [{ name: "lookup", description: "Look it up", parameters: { type: "object", properties: {} } }];

test("each tool result goes back with the turn's own items (reasoning included), until the model answers in text", async () => {
  const reasoning = { type: "reasoning", id: "r1", summary: [], encrypted_content: "enc" };
  const create = vi.fn()
    .mockResolvedValueOnce({ output: [reasoning, call("lookup", { q: "x" })], output_text: "" })
    .mockResolvedValueOnce({ output: [{ type: "message" }], output_text: "done" });
  const onCall = vi.fn(async () => ({ hits: 1 }));
  const out = await runToolLoop({ client: clientWith(create), model: "gpt-5.6-luna", instructions: "sys", content: [text("hi")], tools, maxTurns: 5, onCall });
  expect(out).toBe("done");
  expect(onCall).toHaveBeenCalledWith("lookup", { q: "x" });
  const first = create.mock.calls[0][0];
  expect(first).toMatchObject({
    model: "gpt-5.6-luna", instructions: "sys", store: false,
    reasoning: { effort: "low" }, include: ["reasoning.encrypted_content"],
    tools: [{ type: "function", name: "lookup", description: "Look it up", strict: false }],
  });
  expect(first.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "hi" }] }]);
  expect(create.mock.calls[1][0].input.slice(1)).toEqual([
    reasoning, call("lookup", { q: "x" }), { type: "function_call_output", call_id: "c1", output: JSON.stringify({ hits: 1 }) },
  ]);
});

test("a tool that throws answers the model with its error instead of ending the run", async () => {
  const create = vi.fn()
    .mockResolvedValueOnce({ output: [call("lookup", {})], output_text: "" })
    .mockResolvedValueOnce({ output: [], output_text: "ok" });
  await runToolLoop({ client: clientWith(create), model: "gpt-5.6-luna", instructions: "", content: [], tools, maxTurns: 5, onCall: async () => { throw new Error("no such team"); } });
  expect(create.mock.calls[1][0].input.at(-1)).toEqual({ type: "function_call_output", call_id: "c1", output: JSON.stringify({ error: "no such team" }) });
});

test("a failed turn stops quietly when onTurnError says so, and throws otherwise", async () => {
  const boom = vi.fn().mockRejectedValue(new Error("502"));
  await expect(runToolLoop({ client: clientWith(boom), model: "m", instructions: "", content: [], tools, maxTurns: 3, onCall: async () => null, onTurnError: () => true })).resolves.toBe("");
  await expect(runToolLoop({ client: clientWith(boom), model: "m", instructions: "", content: [], tools, maxTurns: 3, onCall: async () => null })).rejects.toThrow("502");
});

test("the loop gives up after maxTurns", async () => {
  const create = vi.fn().mockResolvedValue({ output: [call("lookup", {})], output_text: "" });
  await runToolLoop({ client: clientWith(create), model: "m", instructions: "", content: [], tools, maxTurns: 3, onCall: async () => null });
  expect(create).toHaveBeenCalledTimes(3);
});

test("respondJson asks for a strict JSON schema and returns the parsed answer with its usage", async () => {
  const create = vi.fn().mockResolvedValue({ output_text: '{"title":"T","description":"D"}', usage: { input_tokens: 10, output_tokens: 5, output_tokens_details: { reasoning_tokens: 2 } } });
  const schema = { type: "object", properties: { title: { type: "string" }, description: { type: "string" } }, required: ["title", "description"], additionalProperties: false };
  const r = await respondJson<{ title: string; description: string }>({ client: clientWith(create), model: "gpt-5.6-luna", instructions: "sys", content: [text("x")], name: "ticket", schema });
  expect(r).toEqual({ value: { title: "T", description: "D" }, usage: { input: 10, output: 5, reasoning: 2 } });
  expect(create.mock.calls[0][0]).toMatchObject({ store: false, reasoning: { effort: "low" }, text: { format: { type: "json_schema", name: "ticket", strict: true, schema } } });
});

test("streamText yields only the text as it arrives", async () => {
  async function* events() {
    yield { type: "response.created" };
    yield { type: "response.output_text.delta", delta: "He" };
    yield { type: "response.output_text.delta", delta: "llo" };
    yield { type: "response.completed" };
  }
  const create = vi.fn().mockResolvedValue(events());
  const parts: string[] = [];
  for await (const d of streamText({ client: clientWith(create), model: "gpt-5.6-luna", instructions: "sys", content: [text("x")] })) parts.push(d);
  expect(parts).toEqual(["He", "llo"]);
  expect(create.mock.calls[0][0]).toMatchObject({ stream: true, store: false, reasoning: { effort: "low" } });
});
