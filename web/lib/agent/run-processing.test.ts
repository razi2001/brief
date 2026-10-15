import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveIssueLookup, Tracker } from "@/lib/tracker";

// The brief row, and every update written to it.
const db = vi.hoisted(() => ({ updates: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/supabase/server", () => ({
  createAdminSupabase: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      for (const op of ["select", "eq"]) b[op] = () => b;
      b.maybeSingle = async () => ({
        data: { id: "b1", user_id: "user_1", storage_prefix: "user_1/b1", share_id: "s1", title: "Pay fails" },
        error: null,
      });
      b.update = (patch: Record<string, unknown>) => ({
        eq: async () => {
          db.updates.push(patch);
          return { error: null };
        },
      });
      return b;
    },
    storage: { from: () => ({ list: async () => ({ data: [] }), remove: async () => ({}) }) },
  }),
}));

const agent = vi.hoisted(() => ({
  tracker: null as Tracker | null,
  processBrief: vi.fn(),
}));
vi.mock("@/lib/trackers/registry", () => ({
  resolveTrackerOrError: async () => ({ tracker: agent.tracker, error: null }),
}));
vi.mock("@/lib/agent/process-brief", () => ({ processBrief: agent.processBrief }));
vi.mock("@/lib/agent/compose-draft", () => ({ composeDraftTicket: vi.fn() }));
vi.mock("@/lib/agent/brief-store", () => ({ supabaseStore: () => ({}) }));
vi.mock("@/lib/agent/load-brief-input", () => ({
  loadBriefInput: async () => ({
    input: { json: {}, images: [], evidence: { items: [], files: [], fallback: [] } },
    names: [],
    includeVideo: false,
    recordingName: null,
  }),
  nearestFrame: vi.fn(),
  urlAt: vi.fn(),
}));
vi.mock("@/lib/settings", () => ({ getUserSettings: async () => ({ ticketGuidance: "", role: "" }) }));
vi.mock("@/lib/brief-filing", () => ({ briefPhase: vi.fn(), releaseFiling: vi.fn() }));

import { filedTicketState, processBriefById } from "./run-processing";

/** A tracker whose only live behaviour is the batch read the tickets feed uses. */
function fakeTracker(getLiveIssues: (ids: string[]) => Promise<LiveIssueLookup>): Tracker {
  return {
    kind: "gitlab",
    targetNoun: "project",
    capabilities: {
      projects: false,
      states: true,
      priority: false,
      labels: true,
      customFields: false,
      issueTypes: false,
      comments: false,
      nativeAttachments: true,
    },
    listTargets: vi.fn(),
    searchIssues: vi.fn(),
    getTargetDetails: vi.fn(),
    fileIssue: vi.fn(),
    updateIssue: vi.fn(),
    getIssue: vi.fn(),
    getLiveIssues: vi.fn(getLiveIssues),
  };
}

const ID = "acme/web#7";
const LIVE = {
  identifier: ID,
  title: "Pay fails",
  url: "https://gitlab.com/acme/web/-/issues/7",
  stateName: "In review",
  stateColor: "#dd6936",
  createdAt: "2026-10-13T10:00:00Z",
};
// What the agent read back with getIssue: GitLab's raw scoped label, no colour.
const AGENT_READ = { name: "workflow::In review", color: null };

describe("filedTicketState", () => {
  it("takes the status the tickets feed would show when the tracker has the issue", async () => {
    const tracker = fakeTracker(async () => ({ issues: { [ID]: LIVE }, gone: [] }));
    expect(await filedTicketState(tracker, ID, AGENT_READ)).toEqual({ name: "In review", color: "#dd6936" });
    expect(tracker.getLiveIssues).toHaveBeenCalledWith([ID]);
  });

  it.each([
    ["the tracker doesn't return the issue", async () => ({ issues: {}, gone: [] })],
    ["the live read throws", async () => Promise.reject(new Error("tracker down"))],
    ["the live state has no name", async () => ({ issues: { [ID]: { ...LIVE, stateName: "" } }, gone: [] })],
  ])("keeps the agent's read when %s", async (_label, read) => {
    const tracker = fakeTracker(read as (ids: string[]) => Promise<LiveIssueLookup>);
    expect(await filedTicketState(tracker, ID, AGENT_READ)).toEqual(AGENT_READ);
  });

  it("keeps the agent's read when the live read takes too long", async () => {
    const tracker = fakeTracker(() => new Promise(() => {}));
    expect(await filedTicketState(tracker, ID, AGENT_READ, 10)).toEqual(AGENT_READ);
  });

  it("stores nothing when neither read has a status", async () => {
    const tracker = fakeTracker(async () => ({ issues: {}, gone: [] }));
    expect(await filedTicketState(tracker, ID, undefined)).toEqual({ name: null, color: null });
  });
});

describe("processBriefById", () => {
  beforeEach(() => {
    db.updates = [];
    agent.processBrief.mockReset();
    agent.processBrief.mockResolvedValue({
      ticketUrl: LIVE.url,
      ticketIdentifier: ID,
      ticketTitle: "Pay fails",
      descriptionMarkdown: "Body",
      ticketState: AGENT_READ,
      summary: "Pay fails",
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("records the filed ticket with the status the feed shows, not the raw label", async () => {
    agent.tracker = fakeTracker(async () => ({ issues: { [ID]: LIVE }, gone: [] }));

    const r = await processBriefById("user_1", "b1");

    expect(r.ok).toBe(true);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toMatchObject({
      status: "filed",
      ticket_identifier: ID,
      ticket_provider: "gitlab",
      ticket_state_name: "In review",
      ticket_state_color: "#dd6936",
    });
  });

  it("falls back to the agent's read when the live read has nothing", async () => {
    agent.tracker = fakeTracker(async () => ({ issues: {}, gone: [] }));

    await processBriefById("user_1", "b1");

    expect(db.updates[0]).toMatchObject({ ticket_state_name: "workflow::In review", ticket_state_color: null });
  });
});
