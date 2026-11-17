import { beforeEach, describe, expect, it, vi } from "vitest";

// Retry files a failed brief. The one exception: a report a quality competition holds
// for its review, whose write-up failed. That one is written up again and
// stays a draft, so it never reaches the tracker around the review.

const session = vi.hoisted(() => ({ userId: "user_1" as string | null }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: session.userId }) }));

const run = vi.hoisted(() => ({ processBriefById: vi.fn(), draftBriefById: vi.fn() }));
vi.mock("@/lib/agent/run-processing", () => run);
vi.mock("@/lib/agent/draft-jobs", () => ({ runDraftJob: (_id: string, write: () => Promise<unknown>) => write() }));
const bash = vi.hoisted(() => ({ heldByBash: vi.fn() }));
vi.mock("@/lib/bash-server", () => bash);
const filing = vi.hoisted(() => ({ claimFiling: vi.fn() }));
vi.mock("@/lib/brief-filing", () => filing);
vi.mock("@/lib/events", () => ({ track: vi.fn() }));

// The brief row as each read sees it, and whether the "write it again" mark lands.
const db = vi.hoisted(() => ({ reads: [] as (Record<string, unknown> | null)[], marked: true, updates: [] as Record<string, unknown>[] }));
vi.mock("@/lib/supabase/server", () => ({
  createAdminSupabase: () => ({
    from: () => {
      let patch: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        eq: () => q,
        is: () => q,
        update: (p: Record<string, unknown>) => {
          patch = p;
          db.updates.push(p);
          return q;
        },
        maybeSingle: async () => ({ data: db.reads.shift() ?? null }),
        then: (ok: (v: { data: unknown[]; error: null }) => unknown) => ok({ data: patch && db.marked ? [{ id: ID }] : [], error: null }),
      };
      return q;
    },
  }),
}));

import { POST } from "./route";

const ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const call = () => POST(new Request("http://x", { method: "POST" }) as never, { params: Promise.resolve({ id: ID }) });
const failed = { id: ID, status: "failed", ticket_body: null, ticket_url: null, filing_started_at: null };

beforeEach(() => {
  session.userId = "user_1";
  db.reads = [];
  db.marked = true;
  db.updates = [];
  run.processBriefById.mockReset().mockResolvedValue({ ok: true, result: { ticketUrl: "https://t/1" } });
  run.draftBriefById.mockReset().mockResolvedValue({ ok: true });
  bash.heldByBash.mockReset().mockResolvedValue(false);
  filing.claimFiling.mockReset().mockResolvedValue(true);
});

describe("POST /api/briefs/[id]/retry", () => {
  it("refuses with no session", async () => {
    session.userId = null;
    expect((await call()).status).toBe(401);
  });

  it("files a failed brief that no quality competition holds, as before", async () => {
    db.reads = [failed];
    const res = await call();
    expect(res.status).toBe(200);
    expect(run.processBriefById).toHaveBeenCalledWith("user_1", ID);
    expect(run.draftBriefById).not.toHaveBeenCalled();
  });

  it("writes a held report up again instead of filing it", async () => {
    bash.heldByBash.mockResolvedValue(true);
    db.reads = [failed, { status: "drafted", error: null }];
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, held: true });
    expect(db.updates[0]).toMatchObject({ status: "processing", error: null });
    expect(run.draftBriefById).toHaveBeenCalledWith("user_1", ID);
    expect(run.processBriefById).not.toHaveBeenCalled();
    expect(filing.claimFiling).not.toHaveBeenCalled();
  });

  it("says why when the write-up fails again", async () => {
    bash.heldByBash.mockResolvedValue(true);
    db.reads = [failed, { status: "failed", error: "The AI service didn't answer." }];
    const res = await call();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("The AI service didn't answer.");
    expect(run.processBriefById).not.toHaveBeenCalled();
  });

  it("files a held report that was already written (its filing failed, not its write-up)", async () => {
    bash.heldByBash.mockResolvedValue(true);
    db.reads = [{ ...failed, ticket_body: "**Summary**" }];
    await call();
    expect(run.processBriefById).toHaveBeenCalled();
    expect(run.draftBriefById).not.toHaveBeenCalled();
  });
});
