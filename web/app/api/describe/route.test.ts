import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The extension's pairing token resolves to user_1; anything else is unknown.
vi.mock("@/lib/extauth", () => ({
  bearerFromHeader: (h: string | null) => (h?.startsWith("Bearer ") ? h.slice(7) : null),
  userIdForToken: async (token: string) => (token === "good" ? "user_1" : null),
}));
const describeNarration = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent/describe-narration", () => ({ describeNarration }));

import { POST } from "./route";

const post = (body: unknown, token = "good") =>
  POST(
    new NextRequest("http://localhost/api/describe", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  describeNarration.mockReset().mockResolvedValue("Pay spins forever.");
});

describe("POST /api/describe", () => {
  it("401s without a known token", async () => {
    expect((await post({ text: "the pay button spins forever" }, "bad")).status).toBe(401);
    expect(describeNarration).not.toHaveBeenCalled();
  });

  it("writes the description from the transcript", async () => {
    expect(await (await post({ text: "  the pay button spins forever " })).json()).toEqual({ description: "Pay spins forever." });
    expect(describeNarration).toHaveBeenCalledWith("the pay button spins forever");
  });

  it("gives an empty description when there is none", async () => {
    describeNarration.mockResolvedValue(null);
    expect(await (await post({ text: "um, testing" })).json()).toEqual({ description: "" });
  });

  it("skips the model for an empty or broken body", async () => {
    expect(await (await post({ text: "   " })).json()).toEqual({ description: "" });
    expect(await (await post("not json")).json()).toEqual({ description: "" });
    expect(await (await post({ text: 42 })).json()).toEqual({ description: "" });
    expect(describeNarration).not.toHaveBeenCalled();
  });
});
