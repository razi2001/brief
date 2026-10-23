import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// after() needs a live request scope; the work it schedules is kept here and
// run by the test, so the background filing is under test too.
const later = vi.hoisted(() => ({ tasks: [] as Array<() => Promise<void>> }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (task: () => Promise<void>) => {
    later.tasks.push(task);
  },
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "user_1" }) }));

/** The brief the route reads: a draft, unless a test says otherwise. */
const row = vi.hoisted(() => ({
  brief: null as Record<string, unknown> | null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminSupabase: () => {
    const b: Record<string, unknown> = {};
    for (const op of ["select", "eq"]) b[op] = () => b;
    b.maybeSingle = async () => ({ data: row.brief, error: null });
    return { from: () => b };
  },
}));

const filing = vi.hoisted(() => ({
  claimFiling: vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true),
  releaseFiling: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
}));
vi.mock("@/lib/brief-filing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/brief-filing")>()),
  ...filing,
}));

const registry = vi.hoisted(() => ({
  resolveTrackerOrError: vi.fn<(...args: unknown[]) => Promise<{ tracker: unknown; error: string | null }>>(
    async () => ({ tracker: { kind: "azure" }, error: null }),
  ),
}));
vi.mock("@/lib/trackers/registry", () => registry);

const processing = vi.hoisted(() => ({
  processBriefById: vi.fn<
    (...args: unknown[]) => Promise<{ ok: true } | { ok: false; status: number; error: string }>
  >(async () => ({ ok: true })),
}));
vi.mock("@/lib/agent/run-processing", () => processing);

import { POST } from "./route";

const PICK = "Pick your Azure DevOps organization under Settings, then retry.";

function exportTo(provider?: string) {
  const req = new NextRequest("http://localhost/api/briefs/b1/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(provider ? { provider } : {}),
  });
  return POST(req, { params: Promise.resolve({ id: "b1" }) });
}

async function runLater() {
  for (const task of later.tasks.splice(0)) await task();
}

beforeEach(() => {
  later.tasks = [];
  row.brief = {
    id: "b1",
    status: "drafted",
    title: null,
    ticket_title: "Title",
    ticket_url: null,
    ticket_body: "Body",
    filing_started_at: null,
  };
  filing.claimFiling.mockClear();
  filing.releaseFiling.mockClear();
  registry.resolveTrackerOrError.mockReset();
  registry.resolveTrackerOrError.mockResolvedValue({ tracker: { kind: "azure" }, error: null });
  processing.processBriefById.mockReset();
  processing.processBriefById.mockResolvedValue({ ok: true });
});

describe("exporting a draft", () => {
  it("answers a tracker that can't file yet with its reason, before claiming the filing", async () => {
    registry.resolveTrackerOrError.mockResolvedValue({ tracker: null, error: PICK });

    const res = await exportTo("azure");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: PICK });
    expect(registry.resolveTrackerOrError).toHaveBeenCalledWith("user_1", "azure");
    expect(filing.claimFiling).not.toHaveBeenCalled();
    expect(later.tasks).toHaveLength(0);
  });

  it("checks whichever tracker files when none is named", async () => {
    await exportTo();
    expect(registry.resolveTrackerOrError).toHaveBeenCalledWith("user_1", undefined);
  });

  it("claims the filing, clearing the last reason, and files in the background", async () => {
    const res = await exportTo("azure");

    expect(await res.json()).toEqual({ queued: true });
    expect(filing.claimFiling).toHaveBeenCalledWith(expect.anything(), "user_1", "b1", { error: null });
    await runLater();
    expect(processing.processBriefById).toHaveBeenCalledWith("user_1", "b1", {
      provider: "azure",
      useExistingContent: true,
    });
    expect(filing.releaseFiling).not.toHaveBeenCalled();
  });

  it("puts a failed export back to draft with the reason it failed", async () => {
    processing.processBriefById.mockResolvedValue({ ok: false, status: 500, error: "Azure DevOps refused the work item." });

    await exportTo("azure");
    await runLater();

    expect(filing.releaseFiling).toHaveBeenCalledWith(expect.anything(), "user_1", "b1", {
      status: "drafted",
      error: "Azure DevOps refused the work item.",
    });
  });

  it("keeps the reason when the filing run throws", async () => {
    processing.processBriefById.mockRejectedValue(new Error("network down"));

    await exportTo("azure");
    await runLater();

    expect(filing.releaseFiling).toHaveBeenCalledWith(expect.anything(), "user_1", "b1", {
      status: "drafted",
      error: "network down",
    });
  });

  it("refuses a draft with no title before asking the tracker", async () => {
    row.brief = { ...row.brief, ticket_title: "  ", title: null };

    const res = await exportTo("azure");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no_title", message: "Add a title first." });
    expect(registry.resolveTrackerOrError).not.toHaveBeenCalled();
    expect(filing.claimFiling).not.toHaveBeenCalled();
  });

  it("files under the capture's own name when the draft has no written title", async () => {
    row.brief = { ...row.brief, ticket_title: null, title: "Checkout button" };

    const res = await exportTo("azure");

    expect(await res.json()).toEqual({ queued: true });
  });

  it("refuses a brief that already has a ticket without asking the tracker", async () => {
    row.brief = { id: "b1", status: "filed", ticket_url: "https://x/1", ticket_body: "Body", filing_started_at: null };

    const res = await exportTo("azure");

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_filed");
    expect(registry.resolveTrackerOrError).not.toHaveBeenCalled();
  });
});
