import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: "user_1" as string | null }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: session.userId }) }));

const review = vi.hoisted(() => ({
  ensureGrouped: vi.fn(),
  moveReport: vi.fn(),
  dropReport: vi.fn(),
  renameGroup: vi.fn(),
  startGroupExport: vi.fn(),
}));
vi.mock("@/lib/bash-review-server", () => review);
const bashes = vi.hoisted(() => ({ loadBash: vi.fn() }));
vi.mock("@/lib/bash-server", () => bashes);
// Run what the route hands to after() right away, so the test can see it.
const ran = vi.hoisted(() => ({ jobs: [] as (() => unknown)[] }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    ran.jobs.push(fn);
  },
}));

import { POST as open } from "./route";
import { PATCH as place } from "./reports/[briefId]/route";
import { PATCH as rename } from "./groups/[groupId]/route";
import { POST as file } from "./groups/[groupId]/export/route";

const CODE = "aB3_-xYz0129";
const BRIEF = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const GROUP = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const json = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as never;
const none = new Request("http://x", { method: "POST" }) as never;
const code = (c = CODE) => ({ params: Promise.resolve({ code: c }) });
const report = (briefId = BRIEF, c = CODE) => ({ params: Promise.resolve({ code: c, briefId }) });
const group = (groupId = GROUP, c = CODE) => ({ params: Promise.resolve({ code: c, groupId }) });

beforeEach(() => {
  session.userId = "user_1";
  ran.jobs.length = 0;
  review.ensureGrouped.mockReset().mockResolvedValue("ok");
  review.moveReport.mockReset().mockResolvedValue("ok");
  review.dropReport.mockReset().mockResolvedValue("ok");
  review.renameGroup.mockReset().mockResolvedValue("ok");
  review.startGroupExport.mockReset().mockResolvedValue({ ok: true, run: vi.fn() });
  bashes.loadBash.mockReset().mockResolvedValue({ code: CODE, review: { grouped: true, groups: [], dropped: [] } });
});

describe("POST /api/bashes/[code]/review", () => {
  it("refuses anyone who is signed out", async () => {
    session.userId = null;
    expect((await open(none, code())).status).toBe(401);
    expect(review.ensureGrouped).not.toHaveBeenCalled();
  });

  it("groups under the caller's id and answers with the bash", async () => {
    const res = await open(none, code());
    expect(res.status).toBe(200);
    expect(review.ensureGrouped).toHaveBeenCalledWith(CODE, "user_1");
    expect(bashes.loadBash).toHaveBeenCalledWith(CODE, "user_1");
    expect((await res.json()).review.grouped).toBe(true);
  });

  it("answers 404 to anyone who didn't start it, and for a code that isn't one", async () => {
    review.ensureGrouped.mockResolvedValue("missing");
    expect((await open(none, code())).status).toBe(404);
    expect((await open(none, code("nope"))).status).toBe(404);
    expect(bashes.loadBash).not.toHaveBeenCalled();
  });

  it("answers 409 while the bash is still running and 500 when grouping can't be saved", async () => {
    review.ensureGrouped.mockResolvedValue("running");
    expect((await open(none, code())).status).toBe(409);
    review.ensureGrouped.mockResolvedValue("error");
    expect((await open(none, code())).status).toBe(500);
  });
});

describe("PATCH /api/bashes/[code]/review/reports/[briefId]", () => {
  it("refuses anyone who is signed out", async () => {
    session.userId = null;
    expect((await place(json({ drop: true }), report())).status).toBe(401);
    expect(review.dropReport).not.toHaveBeenCalled();
  });

  it("moves a report to a group, or to one of its own", async () => {
    expect((await place(json({ to: GROUP }), report())).status).toBe(200);
    expect(review.moveReport).toHaveBeenLastCalledWith(CODE, "user_1", BRIEF, GROUP);
    expect((await place(json({ to: "new" }), report())).status).toBe(200);
    expect(review.moveReport).toHaveBeenLastCalledWith(CODE, "user_1", BRIEF, "new");
  });

  it("leaves a report out", async () => {
    expect((await place(json({ drop: true }), report())).status).toBe(200);
    expect(review.dropReport).toHaveBeenCalledWith(CODE, "user_1", BRIEF);
    expect(review.moveReport).not.toHaveBeenCalled();
  });

  it("refuses a change that names nothing valid", async () => {
    expect((await place(json({}), report())).status).toBe(400);
    expect((await place(json({ to: "somewhere" }), report())).status).toBe(400);
    expect((await place(json({ drop: "yes" }), report())).status).toBe(400);
    expect((await place(json({ to: GROUP }), report("nope"))).status).toBe(404);
    expect(review.moveReport).not.toHaveBeenCalled();
    expect(review.dropReport).not.toHaveBeenCalled();
  });

  it("answers 409 for a group that is already a ticket and 404 when it isn't theirs", async () => {
    review.moveReport.mockResolvedValue("locked");
    expect((await place(json({ to: GROUP }), report())).status).toBe(409);
    review.moveReport.mockResolvedValue("missing");
    expect((await place(json({ to: GROUP }), report())).status).toBe(404);
  });
});

describe("PATCH /api/bashes/[code]/review/groups/[groupId]", () => {
  it("refuses anyone who is signed out", async () => {
    session.userId = null;
    expect((await rename(json({ title: "X" }), group())).status).toBe(401);
    expect(review.renameGroup).not.toHaveBeenCalled();
  });

  it("saves a cleaned title under the caller's id", async () => {
    expect((await rename(json({ title: "  Pay   button \n broken " }), group())).status).toBe(200);
    expect(review.renameGroup).toHaveBeenCalledWith(CODE, "user_1", GROUP, "Pay button broken");
  });

  it("refuses an empty title and a bad id", async () => {
    expect((await rename(json({ title: "  " }), group())).status).toBe(400);
    expect((await rename(json({}), group())).status).toBe(400);
    expect((await rename(json({ title: "X" }), group("nope"))).status).toBe(404);
    expect(review.renameGroup).not.toHaveBeenCalled();
  });

  it("answers 409 once the group is a ticket", async () => {
    review.renameGroup.mockResolvedValue("locked");
    expect((await rename(json({ title: "X" }), group())).status).toBe(409);
  });
});

describe("POST /api/bashes/[code]/review/groups/[groupId]/export", () => {
  it("refuses anyone who is signed out", async () => {
    session.userId = null;
    expect((await file(none, group())).status).toBe(401);
    expect(review.startGroupExport).not.toHaveBeenCalled();
  });

  it("queues the filing in the background once the claims are taken", async () => {
    const run = vi.fn();
    review.startGroupExport.mockResolvedValue({ ok: true, run });
    const res = await file(none, group());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ queued: true });
    expect(review.startGroupExport).toHaveBeenCalledWith(CODE, "user_1", GROUP);
    expect(ran.jobs).toEqual([run]);
  });

  it("says why when there is no tracker to file with, and files nothing", async () => {
    review.startGroupExport.mockResolvedValue({ ok: false, reason: "tracker", message: "Connect a tracker first." });
    const res = await file(none, group());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "tracker", message: "Connect a tracker first." });
    expect(ran.jobs).toEqual([]);
  });

  it("answers 409 for a group already filed, being filed, or with nothing written yet", async () => {
    for (const reason of ["filed", "filing", "empty", "running"] as const) {
      review.startGroupExport.mockResolvedValue({ ok: false, reason });
      const res = await file(none, group());
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(reason);
    }
    expect(ran.jobs).toEqual([]);
  });

  it("answers 404 to anyone who didn't start the bash", async () => {
    review.startGroupExport.mockResolvedValue({ ok: false, reason: "missing" });
    expect((await file(none, group())).status).toBe(404);
  });
});
