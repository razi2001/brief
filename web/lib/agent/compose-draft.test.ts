import { afterEach, beforeEach, expect, test, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({
  default: class {
    responses = { create };
  },
}));

import { composeDraftTicket } from "./compose-draft";

const brief = {
  json: { description: "The pay button returns a 500" },
  images: [],
  evidence: { files: [], items: [], includeVideo: false, fallback: [] },
};

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({
    output_text: JSON.stringify({ title: "Pay button 500s", description: "It 500s." }),
    usage: { input_tokens: 100, output_tokens: 20, output_tokens_details: { reasoning_tokens: 8 } },
  });
});
afterEach(() => {
  delete process.env.AGENT_MODEL;
});

test("the draft writer asks gpt-5.6-luna on the Responses API, reasoning on, for a JSON ticket", async () => {
  expect(await composeDraftTicket(brief as never)).toEqual({
    title: "Pay button 500s",
    descriptionMarkdown: "It 500s.",
    usage: { input: 100, output: 20, reasoning: 8 },
  });
  expect(create.mock.calls[0][0]).toMatchObject({
    model: "gpt-5.6-luna",
    store: false,
    reasoning: { effort: "low" },
    text: { format: { type: "json_schema", name: "ticket", strict: true } },
  });
});

test("an older model set through AGENT_MODEL gets no reasoning", async () => {
  process.env.AGENT_MODEL = "gpt-4o";
  await composeDraftTicket(brief as never);
  expect(create.mock.calls[0][0].model).toBe("gpt-4o");
  expect(create.mock.calls[0][0]).not.toHaveProperty("reasoning");
});

test("the model reads the distilled sections, not the raw brief.json", async () => {
  await composeDraftTicket(brief as never);
  const sent = JSON.stringify(create.mock.calls[0][0].input);
  expect(sent).not.toContain("brief.json:");
  expect(sent).toContain("The pay button returns a 500");
});
