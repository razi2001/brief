import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: "user_1" as string | null, admin: false }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: session.userId }) }));
vi.mock("@/lib/admin-server", () => ({ isAdmin: async () => session.admin }));

const server = vi.hoisted(() => ({
  createRequest: vi.fn(),
  deleteRequest: vi.fn(),
  setStatus: vi.fn(),
  setVote: vi.fn(),
}));
vi.mock("@/lib/requests-server", () => server);

import { POST as create } from "./route";
import { DELETE as remove, PATCH as setStatus } from "./[id]/route";
import { POST as vote } from "./[id]/vote/route";

const ID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const json = (body: unknown) =>
  new Request("http://x/api/requests", { method: "POST", body: JSON.stringify(body) }) as never;
const params = (id = ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  session.userId = "user_1";
  session.admin = false;
  server.createRequest.mockReset().mockResolvedValue({ ok: true, id: ID, createdAt: "2026-11-06T10:00:00Z" });
  server.deleteRequest.mockReset().mockResolvedValue("ok");
  server.setStatus.mockReset().mockResolvedValue("ok");
  server.setVote.mockReset().mockResolvedValue("ok");
});

describe("POST /api/requests", () => {
  it("refuses anyone who is signed out", async () => {
    session.userId = null;
    expect((await create(json({ title: "Dark mode" }))).status).toBe(401);
    expect(server.createRequest).not.toHaveBeenCalled();
  });

  it("saves a cleaned title and details under the caller's id", async () => {
    const res = await create(json({ title: "  Dark   mode ", body: " please " }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: ID, createdAt: "2026-11-06T10:00:00Z" });
    expect(server.createRequest).toHaveBeenCalledWith("user_1", "Dark mode", "please");
  });

  it("refuses a title that is too short or missing", async () => {
    expect((await create(json({ title: "ab" }))).status).toBe(400);
    expect((await create(json({}))).status).toBe(400);
    expect(server.createRequest).not.toHaveBeenCalled();
  });

  it("answers 429 once the daily limit is reached", async () => {
    server.createRequest.mockResolvedValue({ ok: false, reason: "limit" });
    expect((await create(json({ title: "One more idea" }))).status).toBe(429);
  });
});

describe("PATCH /api/requests/[id]", () => {
  it("is the owner's alone: anyone else gets 403 and nothing is written", async () => {
    const res = await setStatus(json({ status: "shipped" }), params());
    expect(res.status).toBe(403);
    expect(server.setStatus).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller before checking anything else", async () => {
    session.userId = null;
    expect((await setStatus(json({ status: "shipped" }), params())).status).toBe(401);
  });

  it("sets the status for the owner", async () => {
    session.admin = true;
    const res = await setStatus(json({ status: "planned" }), params());
    expect(res.status).toBe(200);
    expect(server.setStatus).toHaveBeenCalledWith(ID, "planned");
  });

  it("refuses an unknown status or a malformed id", async () => {
    session.admin = true;
    expect((await setStatus(json({ status: "done" }), params())).status).toBe(400);
    expect((await setStatus(json({ status: "planned" }), params("not-an-id"))).status).toBe(400);
    expect(server.setStatus).not.toHaveBeenCalled();
  });

  it("answers 404 for a request that is gone", async () => {
    session.admin = true;
    server.setStatus.mockResolvedValue("missing");
    expect((await setStatus(json({ status: "planned" }), params())).status).toBe(404);
  });
});

describe("DELETE /api/requests/[id]", () => {
  const del = (id = ID) => remove(new Request(`http://x/api/requests/${id}`, { method: "DELETE" }) as never, params(id));

  it("deletes under the caller's own id, so a member can only ever remove their own", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expect(server.deleteRequest).toHaveBeenCalledWith("user_1", ID, false);
  });

  it("lets the owner delete any request", async () => {
    session.admin = true;
    const res = await del();
    expect(res.status).toBe(200);
    expect(server.deleteRequest).toHaveBeenCalledWith("user_1", ID, true);
  });

  it("never reads the owner flag from the request: only the server's own check sets it", async () => {
    const forged = new Request(`http://x/api/requests/${ID}?asOwner=true`, {
      method: "DELETE",
      headers: { "x-owner": "1" },
      body: JSON.stringify({ asOwner: true, admin: true }),
    });
    await remove(forged as never, params());
    expect(server.deleteRequest).toHaveBeenCalledWith("user_1", ID, false);
  });

  it("refuses a signed-out caller and a malformed id", async () => {
    expect((await del("not-an-id")).status).toBe(400);
    session.userId = null;
    expect((await del()).status).toBe(401);
    expect(server.deleteRequest).not.toHaveBeenCalled();
  });

  it("answers 404 for a request that is gone or isn't theirs", async () => {
    server.deleteRequest.mockResolvedValue("missing");
    expect((await del()).status).toBe(404);
  });

  it("answers 500 when the database fails", async () => {
    server.deleteRequest.mockResolvedValue("error");
    expect((await del()).status).toBe(500);
  });
});

describe("POST /api/requests/[id]/vote", () => {
  it("puts the caller's upvote on and takes it off", async () => {
    expect((await vote(json({ voted: true }), params())).status).toBe(200);
    expect(server.setVote).toHaveBeenLastCalledWith("user_1", ID, true);
    expect((await vote(json({ voted: false }), params())).status).toBe(200);
    expect(server.setVote).toHaveBeenLastCalledWith("user_1", ID, false);
  });

  it("refuses a signed-out caller and a body that isn't true or false", async () => {
    expect((await vote(json({ voted: "yes" }), params())).status).toBe(400);
    session.userId = null;
    expect((await vote(json({ voted: true }), params())).status).toBe(401);
  });

  it("answers 404 for a request that is gone", async () => {
    server.setVote.mockResolvedValue("missing");
    expect((await vote(json({ voted: true }), params())).status).toBe(404);
  });
});
