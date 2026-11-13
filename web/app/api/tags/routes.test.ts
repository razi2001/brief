import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: "user_1" as string | null }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: session.userId }) }));

const server = vi.hoisted(() => ({
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  setBriefsTag: vi.fn(),
}));
vi.mock("@/lib/tags-server", () => server);

import { POST as create } from "./route";
import { DELETE as remove, PATCH as update } from "./[id]/route";
import { POST as assign } from "./[id]/briefs/route";

const TAG = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const BRIEF = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const json = (body: unknown) => new Request("http://x/api/tags", { method: "POST", body: JSON.stringify(body) }) as never;
const params = (id = TAG) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  session.userId = "user_1";
  server.createTag.mockReset().mockResolvedValue({ ok: true, tag: { id: TAG, name: "Checkout", color: "clay", count: 0 } });
  server.updateTag.mockReset().mockResolvedValue("ok");
  server.deleteTag.mockReset().mockResolvedValue("ok");
  server.setBriefsTag.mockReset().mockResolvedValue("ok");
});

describe("POST /api/tags", () => {
  it("refuses anyone who is signed out", async () => {
    session.userId = null;
    expect((await create(json({ name: "Checkout" }))).status).toBe(401);
    expect(server.createTag).not.toHaveBeenCalled();
  });

  it("saves a cleaned name under the caller's id", async () => {
    const res = await create(json({ name: "  Check   out " }));
    expect(res.status).toBe(200);
    expect(server.createTag).toHaveBeenCalledWith("user_1", "Check out", undefined);
  });

  it("passes a listed colour and drops any other", async () => {
    await create(json({ name: "A", color: "sage" }));
    expect(server.createTag).toHaveBeenLastCalledWith("user_1", "A", "sage");
    await create(json({ name: "B", color: "red" }));
    expect(server.createTag).toHaveBeenLastCalledWith("user_1", "B", undefined);
  });

  it("refuses an empty name", async () => {
    expect((await create(json({ name: "  " }))).status).toBe(400);
    expect((await create(json({}))).status).toBe(400);
    expect(server.createTag).not.toHaveBeenCalled();
  });

  it("answers 409 for a name you already have and 429 at the limit", async () => {
    server.createTag.mockResolvedValue({ ok: false, reason: "exists" });
    expect((await create(json({ name: "Checkout" }))).status).toBe(409);
    server.createTag.mockResolvedValue({ ok: false, reason: "limit" });
    expect((await create(json({ name: "One more" }))).status).toBe(429);
  });
});

describe("PATCH /api/tags/[id]", () => {
  it("refuses anyone who is signed out", async () => {
    session.userId = null;
    expect((await update(json({ name: "X" }), params())).status).toBe(401);
    expect(server.updateTag).not.toHaveBeenCalled();
  });

  it("renames and recolours under the caller's id", async () => {
    expect((await update(json({ name: " Pay  flow ", color: "plum" }), params())).status).toBe(200);
    expect(server.updateTag).toHaveBeenCalledWith("user_1", TAG, { name: "Pay flow", color: "plum" });
  });

  it("refuses a bad id, an empty change, an empty name and an unknown colour", async () => {
    expect((await update(json({ name: "X" }), params("nope"))).status).toBe(400);
    expect((await update(json({}), params())).status).toBe(400);
    expect((await update(json({ name: " " }), params())).status).toBe(400);
    expect((await update(json({ color: "red" }), params())).status).toBe(400);
    expect(server.updateTag).not.toHaveBeenCalled();
  });

  it("answers 404 for a tag that isn't yours and 409 for a taken name", async () => {
    server.updateTag.mockResolvedValue("missing");
    expect((await update(json({ name: "X" }), params())).status).toBe(404);
    server.updateTag.mockResolvedValue("exists");
    expect((await update(json({ name: "X" }), params())).status).toBe(409);
  });
});

describe("DELETE /api/tags/[id]", () => {
  it("refuses anyone who is signed out", async () => {
    session.userId = null;
    expect((await remove(json({}), params())).status).toBe(401);
    expect(server.deleteTag).not.toHaveBeenCalled();
  });

  it("deletes under the caller's id, and answers 404 when it isn't theirs", async () => {
    expect((await remove(json({}), params())).status).toBe(200);
    expect(server.deleteTag).toHaveBeenCalledWith("user_1", TAG);
    server.deleteTag.mockResolvedValue("missing");
    expect((await remove(json({}), params())).status).toBe(404);
  });
});

describe("POST /api/tags/[id]/briefs", () => {
  it("refuses anyone who is signed out", async () => {
    session.userId = null;
    expect((await assign(json({ briefIds: [BRIEF], on: true }), params())).status).toBe(401);
    expect(server.setBriefsTag).not.toHaveBeenCalled();
  });

  it("tags the named briefs under the caller's id, dropping ids that aren't ids", async () => {
    expect((await assign(json({ briefIds: [BRIEF, "x", BRIEF], on: true }), params())).status).toBe(200);
    expect(server.setBriefsTag).toHaveBeenCalledWith("user_1", TAG, [BRIEF], true);
  });

  it("takes the tag off with on: false", async () => {
    await assign(json({ briefIds: [BRIEF], on: false }), params());
    expect(server.setBriefsTag).toHaveBeenCalledWith("user_1", TAG, [BRIEF], false);
  });

  it("refuses a bad tag id, no briefs, or no on/off", async () => {
    expect((await assign(json({ briefIds: [BRIEF], on: true }), params("nope"))).status).toBe(400);
    expect((await assign(json({ briefIds: [], on: true }), params())).status).toBe(400);
    expect((await assign(json({ briefIds: [BRIEF] }), params())).status).toBe(400);
    expect((await assign(json({ briefIds: [BRIEF], on: "yes" }), params())).status).toBe(400);
    expect(server.setBriefsTag).not.toHaveBeenCalled();
  });

  it("answers 404 for a tag that isn't yours", async () => {
    server.setBriefsTag.mockResolvedValue("missing");
    expect((await assign(json({ briefIds: [BRIEF], on: true }), params())).status).toBe(404);
  });
});
