import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: "user_1" as string | null, admin: true }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: session.userId }) }));
vi.mock("@/lib/admin-server", () => ({ isAdmin: async () => session.admin }));

const ext = vi.hoisted(() => ({ userId: "user_9" as string | null }));
vi.mock("@/lib/extauth", () => ({
  bearerFromHeader: (h: string | null) => (h ? h.replace(/^Bearer /, "") : null),
  userIdForToken: async () => ext.userId,
}));

const server = vi.hoisted(() => ({
  saveText: vi.fn(),
  createPush: vi.fn(),
  answerFor: vi.fn(),
}));
vi.mock("@/lib/nudge-server", () => server);

import { PUT as saveText } from "./route";
import { POST as push } from "./push/route";
import { GET as answer } from "../../nudge/route";

const body = (method: string, b: unknown) => new Request("http://x/api", { method, body: JSON.stringify(b) }) as never;

beforeEach(() => {
  session.userId = "user_1";
  session.admin = true;
  ext.userId = "user_9";
  server.saveText.mockReset().mockResolvedValue(true);
  server.createPush.mockReset().mockResolvedValue({ id: "p1", at: "2026-11-07T10:00:00Z" });
  server.answerFor.mockReset().mockResolvedValue({ message: "Seen a bug?", button: "Brief it", push: null });
});

describe("PUT /api/admin/nudge", () => {
  it("is the owner's alone", async () => {
    session.admin = false;
    expect((await saveText(body("PUT", { message: "Hi" }))).status).toBe(403);
    session.userId = null;
    expect((await saveText(body("PUT", { message: "Hi" }))).status).toBe(401);
    expect(server.saveText).not.toHaveBeenCalled();
  });

  it("saves cleaned, capped text", async () => {
    const res = await saveText(body("PUT", { message: "  Found  a glitch? ", button: "b".repeat(40) }));
    expect(res.status).toBe(200);
    expect(server.saveText).toHaveBeenCalledWith({ message: "Found a glitch?", button: "b".repeat(24) });
  });

  it("refuses a body that isn't text", async () => {
    expect((await saveText(body("PUT", { message: ["x"] }))).status).toBe(400);
  });
});

describe("POST /api/admin/nudge/push", () => {
  it("is the owner's alone", async () => {
    session.admin = false;
    expect((await push(body("POST", {}))).status).toBe(403);
    expect(server.createPush).not.toHaveBeenCalled();
  });

  it("pushes to the people picked, or to everyone", async () => {
    expect((await push(body("POST", { userIds: ["user_2abc", "user_3def", "user_2abc"] }))).status).toBe(200);
    expect(server.createPush).toHaveBeenLastCalledWith(["user_2abc", "user_3def"]);
    expect((await push(body("POST", { userId: "user_2abc" }))).status).toBe(200);
    expect(server.createPush).toHaveBeenLastCalledWith(["user_2abc"]);
    expect((await push(body("POST", {}))).status).toBe(200);
    expect(server.createPush).toHaveBeenLastCalledWith(null);
  });

  it("refuses ids that aren't Clerk ids, and an empty pick", async () => {
    expect((await push(body("POST", { userIds: ["a,user_id.is.null"] }))).status).toBe(400);
    expect((await push(body("POST", { userIds: [] }))).status).toBe(400);
    expect(server.createPush).not.toHaveBeenCalled();
  });
});

describe("GET /api/nudge", () => {
  const get = (auth?: string) =>
    new Request("http://x/api/nudge", { headers: auth ? { authorization: auth } : {} }) as never;

  it("needs a pairing token", async () => {
    expect((await answer(get())).status).toBe(401);
    ext.userId = null;
    expect((await answer(get("Bearer dead"))).status).toBe(401);
  });

  it("answers for the token's own user", async () => {
    const res = await answer(get("Bearer t"));
    expect(res.status).toBe(200);
    expect(server.answerFor).toHaveBeenCalledWith("user_9");
    expect(await res.json()).toEqual({ message: "Seen a bug?", button: "Brief it", push: null });
  });
});
