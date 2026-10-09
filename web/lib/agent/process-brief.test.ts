import { beforeEach, expect, test, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

import { processBrief } from "./process-brief";
import { NO_CAPABILITIES, type Tracker } from "@/lib/tracker";

const tracker: Tracker = {
  kind: "linear",
  targetNoun: "team",
  capabilities: NO_CAPABILITIES,
  listTargets: async () => [{ id: "t1", key: "ENG", name: "Engineering" }],
  searchIssues: async () => [],
  getTargetDetails: async () => ({ id: "t1", key: "ENG", name: "Engineering", states: [], labels: [], members: [] }),
  fileIssue: async (input) => ({ id: "i1", identifier: "ENG-1", url: "https://linear.app/x/issue/ENG-1", title: input.title }),
  updateIssue: async () => ({ ok: true }),
  getIssue: async () => ({ title: "Pay button 500s" }),
  getLiveIssues: async () => ({ issues: {}, gone: [] }),
};

const brief = {
  json: { description: "The pay button returns a 500" },
  images: [],
  evidence: { files: [], items: [], includeVideo: false, fallback: [] },
};

beforeEach(() => {
  create.mockReset();
  // Turn 1 files the issue, turn 2 wraps up without tools.
  create
    .mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "create_issue",
                  arguments: JSON.stringify({ targetId: "t1", title: "Pay button 500s", description: "It 500s." }),
                },
              },
            ],
          },
        },
      ],
    })
    .mockResolvedValue({ choices: [{ message: { role: "assistant", content: "Filed ENG-1." } }] });
});

test("every turn of the filing agent asks gpt-5.6-luna with reasoning off, so its tools are accepted", async () => {
  const result = await processBrief(brief as never, tracker);
  expect(result.ticketIdentifier).toBe("ENG-1");
  expect(create.mock.calls.length).toBeGreaterThanOrEqual(2);
  for (const [params] of create.mock.calls) {
    expect(params).toMatchObject({ model: "gpt-5.6-luna", reasoning_effort: "none", tool_choice: "auto" });
  }
});
