import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: "user_1" as string | null }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: session.userId }) }));
const server = vi.hoisted(() => ({ suggestBashes: vi.fn() }));
vi.mock("@/lib/bash-suggest-server", () => server);

import { GET } from "./route";

beforeEach(() => {
  session.userId = "user_1";
  server.suggestBashes.mockReset().mockResolvedValue([{ name: "Checkout", bugs: 3, open: 2 }]);
});

describe("GET /api/bashes/suggestions", () => {
  it("refuses anyone who is signed out", async () => {
    session.userId = null;
    expect((await GET()).status).toBe(401);
    expect(server.suggestBashes).not.toHaveBeenCalled();
  });

  it("answers with the caller's suggestions, never cached", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ suggestions: [{ name: "Checkout", bugs: 3, open: 2 }] });
    expect(server.suggestBashes).toHaveBeenCalledWith("user_1");
  });

  it("answers an empty list when they can't be worked out", async () => {
    server.suggestBashes.mockRejectedValue(new Error("model down"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: [] });
  });
});
