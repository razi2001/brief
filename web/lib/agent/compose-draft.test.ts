import { afterEach, beforeEach, expect, test, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create } };
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
    choices: [
      {
        message: {
          tool_calls: [
            {
              type: "function",
              function: { name: "compose_ticket", arguments: JSON.stringify({ title: "Pay button 500s", description: "It 500s." }) },
            },
          ],
        },
      },
    ],
  });
});
afterEach(() => {
  delete process.env.AGENT_MODEL;
});

test("the draft composer asks gpt-5.6-luna with reasoning off, so its forced tool call is accepted", async () => {
  expect(await composeDraftTicket(brief as never)).toEqual({ title: "Pay button 500s", descriptionMarkdown: "It 500s." });
  expect(create.mock.calls[0][0]).toMatchObject({ model: "gpt-5.6-luna", reasoning_effort: "none" });
});

test("an older model set through AGENT_MODEL gets no reasoning_effort", async () => {
  process.env.AGENT_MODEL = "gpt-4o";
  await composeDraftTicket(brief as never);
  expect(create.mock.calls[0][0].model).toBe("gpt-4o");
  expect(create.mock.calls[0][0]).not.toHaveProperty("reasoning_effort");
});
