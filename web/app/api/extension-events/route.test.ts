import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The extension's pairing token resolves to user_1; anything else is unknown.
vi.mock("@/lib/extauth", () => ({
  bearerFromHeader: (h: string | null) => (h?.startsWith("Bearer ") ? h.slice(7) : null),
  userIdForToken: async (token: string) => (token === "good" ? "user_1" : null),
}));
const tracked = vi.hoisted(() => ({ rows: [] as unknown[][] }));
vi.mock("@/lib/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events")>()),
  track: (...args: unknown[]) => tracked.rows.push(args),
}));

import { POST } from "./route";

const send = (body: unknown, token = "good") =>
  POST(
    new NextRequest("http://localhost/api/extension-events", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  tracked.rows = [];
});

describe("POST /api/extension-events", () => {
  it("records the reminder's three events for the token's user", async () => {
    expect((await send({ name: "nudge.shown", props: { replay: true } })).status).toBe(204);
    expect((await send({ name: "nudge.brief_it" })).status).toBe(204);
    expect((await send({ name: "nudge.closed", props: {} })).status).toBe(204);
    expect(tracked.rows).toEqual([
      ["user_1", "nudge.shown", { replay: true }],
      ["user_1", "nudge.brief_it", {}],
      ["user_1", "nudge.closed", {}],
    ]);
  });

  it("keeps nothing about the page, whatever is sent", async () => {
    await send({ name: "nudge.shown", props: { replay: false, url: "https://bank.example/x", title: "Inbox", host: "bank.example" } });
    await send({ name: "nudge.closed", props: { replay: true, url: "https://bank.example/x" } });
    expect(tracked.rows).toEqual([
      ["user_1", "nudge.shown", { replay: false }],
      ["user_1", "nudge.closed", {}],
    ]);
  });

  it("refuses any other name, including the server's and the browser's", async () => {
    for (const name of ["brief.created", "extension.opened", "page.view", "site.view", "nudge.other", "", undefined]) {
      expect((await send({ name, props: {} })).status).toBe(400);
    }
    expect((await send("not json")).status).toBe(400);
    expect(tracked.rows).toEqual([]);
  });

  it("refuses an unknown token", async () => {
    expect((await send({ name: "nudge.shown", props: { replay: true } }, "bad")).status).toBe(401);
    expect(tracked.rows).toEqual([]);
  });

  it("keeps the id of the owner's push that opened it, nothing else", async () => {
    tracked.rows.length = 0;
    const id = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
    await send({ name: "nudge.shown", props: { replay: true, push: id } });
    await send({ name: "nudge.closed", props: { push: id } });
    await send({ name: "nudge.brief_it", props: { push: "not-a-uuid" } });
    expect(tracked.rows).toEqual([
      ["user_1", "nudge.shown", { replay: true, push: id }],
      ["user_1", "nudge.closed", { push: id }],
      ["user_1", "nudge.brief_it", {}],
    ]);
  });
});
