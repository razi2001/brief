import { beforeEach, expect, test, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({
  default: class {
    responses = { create };
  },
}));

import { normalizeSectionLabels, processBrief } from "./process-brief";
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

// A Responses API turn that calls create_issue, and one that wraps up in text.
const callTurn = (args: object) => ({
  output: [{ type: "function_call", call_id: "call_1", name: "create_issue", arguments: JSON.stringify(args) }],
  output_text: "",
});
const doneTurn = { output: [{ type: "message" }], output_text: "Filed." };

beforeEach(() => {
  create.mockReset();
  // Turn 1 files the issue, turn 2 wraps up without tools.
  create.mockResolvedValueOnce(callTurn({ targetId: "t1", title: "Pay button 500s", description: "It 500s." })).mockResolvedValue(doneTurn);
});

test("every turn of the filing agent asks gpt-5.6-luna on the Responses API, reasoning on, nothing stored", async () => {
  const result = await processBrief(brief as never, tracker);
  expect(result.ticketIdentifier).toBe("ENG-1");
  expect(create.mock.calls.length).toBeGreaterThanOrEqual(2);
  for (const [params] of create.mock.calls) {
    expect(params).toMatchObject({ model: "gpt-5.6-luna", store: false, reasoning: { effort: "low" }, include: ["reasoning.encrypted_content"] });
  }
});

test("a turn that fails after the issue exists keeps the issue (a retry would file it twice)", async () => {
  create.mockReset();
  create.mockResolvedValueOnce(callTurn({ targetId: "t1", title: "Pay button 500s", description: "It 500s." })).mockRejectedValue(new Error("502"));
  expect((await processBrief(brief as never, tracker)).ticketIdentifier).toBe("ENG-1");
});

test("a replay's stills on the ticket are exactly the flagged ones, captioned, and no link where uploads work", async () => {
  // The agent asks for an extra replay still; it must not land.
  create.mockReset();
  create
    .mockResolvedValueOnce(callTurn({ targetId: "t1", title: "Slow list", description: "It hangs.\n\nSteps to reproduce\n1. Open it", attach: ["frame-01.jpg", "frame-02.jpg"] }))
    .mockResolvedValue(doneTurn);
  const fileIssue = vi.fn(tracker.fileIssue);
  const withReplay = {
    json: { description: "slow" },
    images: [],
    evidence: {
      files: [{ filename: "frame-02.jpg", contentType: "image/jpeg", bytes: Buffer.from("x") }],
      items: [{ name: "frame-02.jpg", kind: "replay", caption: "page took too long" }],
      includeVideo: false,
      fallback: ["frame-02.jpg"],
      forced: ["frame-02.jpg"],
    },
  };
  await processBrief(withReplay as never, { ...tracker, fileIssue });
  const input = fileIssue.mock.calls[0][0];
  expect(input.evidence.map((e: { filename: string }) => e.filename)).toEqual(["frame-02.jpg"]);
  expect(input.evidence[0].caption).toBe("page took too long");
  expect(input.descriptionMarkdown).toContain("**Steps to reproduce**");
  expect(input.descriptionMarkdown).not.toContain("Replay:");
});

test("the replay's video goes on the ticket with the flagged still, whatever the agent picks", async () => {
  create.mockReset();
  create.mockResolvedValueOnce(callTurn({ targetId: "t1", title: "Slow list", description: "It hangs.", attach: [] })).mockResolvedValue(doneTurn);
  const fileIssue = vi.fn(tracker.fileIssue);
  await processBrief({
    json: { description: "slow" },
    images: [],
    evidence: {
      files: [
        { filename: "replay.webm", contentType: "video/webm", bytes: Buffer.from("v") },
        { filename: "frame-02.jpg", contentType: "image/jpeg", bytes: Buffer.from("x") },
      ],
      items: [
        { name: "replay.webm", kind: "replay-video" },
        { name: "frame-02.jpg", kind: "replay", caption: "page took too long" },
      ],
      includeVideo: false,
      fallback: ["replay.webm", "frame-02.jpg"],
      forced: ["replay.webm", "frame-02.jpg"],
    },
  } as never, { ...tracker, fileIssue });
  expect(fileIssue.mock.calls[0][0].evidence.map((e: { filename: string }) => e.filename)).toEqual(["replay.webm", "frame-02.jpg"]);
});

test("the model reads the distilled sections, not the raw brief.json", async () => {
  await processBrief(brief as never, tracker);
  const sent = JSON.stringify(create.mock.calls[0][0].input);
  expect(sent).not.toContain("brief.json:");
  expect(sent).toContain("The pay button returns a 500");
});

test("Summary and Technical notes written as plain lines become labels like the other sections", () => {
  expect(normalizeSectionLabels("Summary\nIt breaks.\n\nTechnical notes:\n- The save call returns 500.")).toBe("**Summary**\nIt breaks.\n\n**Technical notes**\n- The save call returns 500.");
});

test("search_issues and the prompt name the tracker by its own name, whichever it is", async () => {
  // It once said "Linear" for a team and "Jira" for anything else, so an Azure
  // DevOps user's agent was told to search Jira.
  await processBrief(brief as never, { ...tracker, kind: "azure", targetNoun: "project" });
  const params = create.mock.calls[0][0] as { tools: Array<{ name: string; description: string }>; instructions: string };
  const search = params.tools.find((t) => t.name === "search_issues");
  expect(search?.description).toContain("Search EXISTING Azure DevOps issues");
  expect(search?.description).not.toMatch(/Linear|Jira/);
  expect(params.instructions).toContain("THIS TRACKER: Azure DevOps.");
});
