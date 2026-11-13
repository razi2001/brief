import { beforeEach, describe, expect, it, vi } from "vitest";

// What a bug bash changes about "Create ticket", when the reporter is in a
// running one and left the popup switch on: one that holds keeps the brief as
// a draft (no tracker needed, nothing filed); one that doesn't files it with
// its name as a label. With the switch off, or in no bug bash, it files
// exactly as before and counts for nothing.

const who = vi.hoisted(() => ({ userId: "user_1" as string | null }));
vi.mock("@/lib/extauth", () => ({
  bearerFromHeader: (h: string | null) => (h ? "tok" : null),
  userIdForToken: async () => who.userId,
}));

const bash = vi.hoisted(() => ({ runningBashOf: vi.fn(), markForBash: vi.fn() }));
vi.mock("@/lib/bash-server", () => bash);

const tracker = vi.hoisted(() => ({ trackerStatus: vi.fn(), NO_TRACKER_ERROR: "No tracker connected." }));
vi.mock("@/lib/trackers/registry", () => tracker);

const run = vi.hoisted(() => ({ processBriefById: vi.fn(), draftBriefById: vi.fn() }));
vi.mock("@/lib/agent/run-processing", () => run);
vi.mock("@/lib/agent/draft-jobs", () => ({ runDraftJob: (_id: string, write: () => Promise<unknown>) => write() }));
const hold = vi.hoisted(() => ({ holdAsDraft: vi.fn() }));
vi.mock("@/lib/agent/hold-draft", () => hold);

const filing = vi.hoisted(() => ({ claimFiling: vi.fn() }));
vi.mock("@/lib/brief-filing", async (orig) => ({ ...(await orig<typeof import("@/lib/brief-filing")>()), claimFiling: filing.claimFiling }));
vi.mock("@/lib/events", () => ({ track: vi.fn() }));

const row = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
vi.mock("@/lib/supabase/server", () => ({
  createAdminSupabase: () => ({
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row.value }) };
      return q;
    },
  }),
}));

const jobs = vi.hoisted(() => ({ list: [] as (() => Promise<unknown>)[] }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => Promise<unknown>) => {
    jobs.list.push(fn);
  },
}));

import { POST } from "./route";

const ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const call = (body: unknown = {}) =>
  POST(
    new Request("http://x", { method: "POST", headers: { authorization: "Bearer tok" }, body: JSON.stringify(body) }) as never,
    { params: Promise.resolve({ id: ID }) },
  );
const drain = async () => {
  for (const j of jobs.list.splice(0)) await j();
};

beforeEach(() => {
  who.userId = "user_1";
  jobs.list.length = 0;
  row.value = { id: ID, share_id: null, storage_prefix: "u/x", status: "uploaded", ticket_body: null, ticket_url: null, filing_started_at: null };
  bash.runningBashOf.mockReset().mockResolvedValue(null);
  bash.markForBash.mockReset().mockResolvedValue(undefined);
  tracker.trackerStatus.mockReset().mockResolvedValue({ tracker: { kind: "linear" }, issue: null });
  run.processBriefById.mockReset().mockResolvedValue({ ok: true });
  run.draftBriefById.mockReset().mockResolvedValue({ ok: true });
  hold.holdAsDraft.mockReset().mockResolvedValue("share0000001");
  filing.claimFiling.mockReset().mockResolvedValue(true);
});

describe("POST /api/briefs/[id]/process", () => {
  it("refuses a call with no valid token", async () => {
    who.userId = null;
    expect((await call()).status).toBe(401);
    expect(bash.runningBashOf).not.toHaveBeenCalled();
  });

  it("files as before when the reporter is in no bash", async () => {
    const res = await call({ title: "Pay fails" });
    expect(res.status).toBe(200);
    expect((await res.json()).held).toBeUndefined();
    await drain();
    expect(filing.claimFiling).toHaveBeenCalled();
    expect(run.processBriefById).toHaveBeenCalledWith("user_1", ID, expect.objectContaining({ instruction: undefined }));
    expect(hold.holdAsDraft).not.toHaveBeenCalled();
    expect(bash.markForBash).not.toHaveBeenCalled();
  });

  it("still refuses with no tracker outside a bash", async () => {
    tracker.trackerStatus.mockResolvedValue({ tracker: null, issue: "Connect a tracker." });
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_tracker");
  });

  it("holds the brief as a draft for a bug bash that holds: no tracker asked, nothing filed", async () => {
    bash.runningBashOf.mockResolvedValue({ id: "b1", name: "Release 2.4", hold: true });
    tracker.trackerStatus.mockResolvedValue({ tracker: null, issue: "Connect a tracker." });
    const res = await call({ title: "Pay fails", description: "It does nothing" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ queued: true, shareId: "share0000001", held: true });
    expect(tracker.trackerStatus).not.toHaveBeenCalled();
    expect(filing.claimFiling).not.toHaveBeenCalled();
    expect(hold.holdAsDraft).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      ID,
      { share_id: null, storage_prefix: "u/x" },
      expect.objectContaining({ title: "Pay fails", description: "It does nothing" }),
      "Pay fails",
    );
    expect(bash.markForBash).toHaveBeenCalledWith("b1", ID, expect.anything());
    await drain();
    expect(run.draftBriefById).toHaveBeenCalledWith("user_1", ID);
    expect(run.processBriefById).not.toHaveBeenCalled();
  });

  it("leaves the bug bash out when the popup switch is off: filed as usual, not counted, not even looked up", async () => {
    bash.runningBashOf.mockResolvedValue({ id: "b1", name: "Release 2.4", hold: true });
    const res = await call({ title: "Unrelated bug", bash: false });
    expect(res.status).toBe(200);
    expect((await res.json()).held).toBeUndefined();
    expect(bash.runningBashOf).not.toHaveBeenCalled();
    expect(bash.markForBash).not.toHaveBeenCalled();
    expect(hold.holdAsDraft).not.toHaveBeenCalled();
    await drain();
    expect(run.processBriefById).toHaveBeenCalledWith("user_1", ID, expect.objectContaining({ instruction: undefined }));
  });

  it("counts a brief from an extension that sends no switch at all", async () => {
    bash.runningBashOf.mockResolvedValue({ id: "b2", name: "November quality", hold: false });
    expect((await call({ title: "Old popup" })).status).toBe(200);
    expect(bash.markForBash).toHaveBeenCalledWith("b2", ID, expect.anything());
  });

  it("doesn't count a brief whose filing was refused", async () => {
    bash.runningBashOf.mockResolvedValue({ id: "b2", name: "November quality", hold: false });
    filing.claimFiling.mockResolvedValue(false);
    expect((await call()).status).toBe(409);
    expect(bash.markForBash).not.toHaveBeenCalled();
  });

  it("never turns a brief that already has a ticket back into a held draft", async () => {
    bash.runningBashOf.mockResolvedValue({ id: "b1", name: "Release 2.4", hold: true });
    row.value = { ...row.value, status: "filed", ticket_url: "https://t/1", share_id: "s" };
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_filed");
    expect(hold.holdAsDraft).not.toHaveBeenCalled();
  });

  it("counts a brief that is already a written draft without writing it again (a retry)", async () => {
    bash.runningBashOf.mockResolvedValue({ id: "b1", name: "Release 2.4", hold: true });
    row.value = { ...row.value, status: "drafted", ticket_body: "**Summary**", share_id: "s1" };
    const res = await call({ title: "Pay fails" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ queued: true, shareId: "s1", held: true });
    expect(hold.holdAsDraft).not.toHaveBeenCalled();
    expect(bash.markForBash).toHaveBeenCalledWith("b1", ID, expect.anything());
    await drain();
    expect(run.draftBriefById).not.toHaveBeenCalled();
  });

  it("files with the bug bash's name as a label when it doesn't hold, and counts the brief", async () => {
    bash.runningBashOf.mockResolvedValue({ id: "b2", name: "November quality", hold: false });
    expect((await call()).status).toBe(200);
    expect(bash.markForBash).toHaveBeenCalledWith("b2", ID, expect.anything());
    await drain();
    expect(hold.holdAsDraft).not.toHaveBeenCalled();
    const opts = run.processBriefById.mock.calls[0][2] as { instruction?: string };
    expect(opts.instruction).toContain('Put the label "November quality" on it');
  });

  it("files the normal way when the bash can't be read", async () => {
    bash.runningBashOf.mockRejectedValue(new Error("db down"));
    expect((await call()).status).toBe(200);
    await drain();
    expect(run.processBriefById).toHaveBeenCalledWith("user_1", ID, expect.objectContaining({ instruction: undefined }));
  });
});
