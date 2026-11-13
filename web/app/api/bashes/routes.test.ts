import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: "user_1" as string | null }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: session.userId }) }));

const server = vi.hoisted(() => ({
  createBash: vi.fn(),
  loadBash: vi.fn(),
  joinBash: vi.fn(),
  startBash: vi.fn(),
  leaveBash: vi.fn(),
  endBash: vi.fn(),
}));
vi.mock("@/lib/bash-server", () => server);
const events = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@/lib/events", () => events);

import { POST as create } from "./route";
import { GET as read } from "./[code]/route";
import { POST as join } from "./[code]/join/route";
import { POST as start } from "./[code]/start/route";
import { POST as leave } from "./[code]/leave/route";
import { POST as end } from "./[code]/end/route";

const CODE = "aB3_-xYz0129";
const json = (body: unknown) => new Request("http://x/api/bashes", { method: "POST", body: JSON.stringify(body) }) as never;
const none = new Request("http://x/api/bashes/x", { method: "POST" }) as never;
const params = (code = CODE) => ({ params: Promise.resolve({ code }) });

// "Now" is fixed, so the dates below mean the same thing on every run.
const NOW = "2026-11-12T09:00:00.000Z";
const FROM = "2026-11-14T00:00:00.000Z";
const TO = "2026-11-17T22:59:59.000Z";
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  session.userId = "user_1";
  events.track.mockReset();
  server.createBash.mockReset().mockResolvedValue({ ok: true, code: CODE });
  server.loadBash.mockReset().mockResolvedValue({ code: CODE, name: "Release 2.4", people: [], briefs: [] });
  server.joinBash.mockReset().mockResolvedValue("ok");
  server.startBash.mockReset().mockResolvedValue("ok");
  server.leaveBash.mockReset().mockResolvedValue("ok");
  server.endBash.mockReset().mockResolvedValue("ok");
});

describe("POST /api/bashes", () => {
  it("refuses anyone who is signed out", async () => {
    session.userId = null;
    expect((await create(json({ name: "Release 2.4", minutes: 45, startsAt: FROM, endsAt: TO }))).status).toBe(401);
    expect(server.createBash).not.toHaveBeenCalled();
  });

  it("creates one under the caller's id, with its dates and duration, and answers with its code", async () => {
    const res = await create(json({ name: "  Release   2.4 ", minutes: 30, startsAt: FROM, endsAt: TO }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, code: CODE });
    expect(server.createBash).toHaveBeenCalledWith("user_1", "Release 2.4", 30, { startsAt: FROM, endsAt: TO }, undefined);
    expect(events.track).toHaveBeenCalledWith("user_1", "bash.started", { minutes: 30 });
  });

  it("starts now when the start date is today, already begun", async () => {
    await create(json({ name: "Today", minutes: 60, startsAt: "2026-11-12T00:00:00.000Z", endsAt: TO }));
    expect(server.createBash).toHaveBeenLastCalledWith("user_1", "Today", 60, { startsAt: NOW, endsAt: TO }, undefined);
  });

  it("passes the review choice when one is made, and ignores one that isn't yes or no", async () => {
    const dates = { startsAt: FROM, endsAt: TO };
    await create(json({ name: "A", minutes: 180, hold: true, ...dates }));
    expect(server.createBash).toHaveBeenLastCalledWith("user_1", "A", 180, dates, true);
    await create(json({ name: "B", minutes: 15, hold: false, ...dates }));
    expect(server.createBash).toHaveBeenLastCalledWith("user_1", "B", 15, dates, false);
    await create(json({ name: "C", minutes: 15, hold: "yes", ...dates }));
    expect(server.createBash).toHaveBeenLastCalledWith("user_1", "C", 15, dates, undefined);
  });

  it("refuses an empty name and a duration that isn't offered", async () => {
    const dates = { startsAt: FROM, endsAt: TO };
    expect((await create(json({ name: " ", minutes: 45, ...dates }))).status).toBe(400);
    expect((await create(json({ name: "X", minutes: 44, ...dates }))).status).toBe(400);
    // more than 3 hours each
    expect((await create(json({ name: "X", minutes: 300, ...dates }))).status).toBe(400);
    expect((await create(json({ name: "X", minutes: "45", ...dates }))).status).toBe(400);
    expect((await create(json({ name: "X", ...dates }))).status).toBe(400);
    expect(server.createBash).not.toHaveBeenCalled();
  });

  it("refuses dates that are missing, backwards, past, or too far apart", async () => {
    const bad = async (startsAt: unknown, endsAt: unknown) => {
      const res = await create(json({ name: "X", minutes: 45, startsAt, endsAt }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("dates");
    };
    await bad(undefined, undefined);
    await bad(FROM, FROM);
    await bad(TO, FROM);
    await bad("2026-11-01T00:00:00.000Z", "2026-11-05T00:00:00.000Z");
    await bad(FROM, "2027-01-20T00:00:00.000Z");
    await bad("soon", TO);
    expect(server.createBash).not.toHaveBeenCalled();
  });

  it("answers 429 once the daily limit is reached", async () => {
    server.createBash.mockResolvedValue({ ok: false, reason: "limit" });
    expect((await create(json({ name: "X", minutes: 45, startsAt: FROM, endsAt: TO }))).status).toBe(429);
    expect(events.track).not.toHaveBeenCalled();
  });
});

describe("GET /api/bashes/[code]", () => {
  it("refuses anyone who is signed out", async () => {
    session.userId = null;
    expect((await read(none, params())).status).toBe(401);
    expect(server.loadBash).not.toHaveBeenCalled();
  });

  it("answers with the bug bash as the caller sees it, never cached", async () => {
    const res = await read(none, params());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(server.loadBash).toHaveBeenCalledWith(CODE, "user_1");
  });

  it("answers 404 for a code that isn't one, without asking the database", async () => {
    expect((await read(none, params("nope"))).status).toBe(404);
    expect(server.loadBash).not.toHaveBeenCalled();
  });

  it("answers 404 when there is no such bug bash", async () => {
    server.loadBash.mockResolvedValue(null);
    expect((await read(none, params())).status).toBe(404);
  });
});

describe("POST /api/bashes/[code]/join", () => {
  it("refuses anyone who is signed out", async () => {
    session.userId = null;
    expect((await join(none, params())).status).toBe(401);
    expect(server.joinBash).not.toHaveBeenCalled();
  });

  it("joins under the caller's id, without starting their time", async () => {
    expect((await join(none, params())).status).toBe(200);
    expect(server.joinBash).toHaveBeenCalledWith("user_1", CODE);
    expect(server.startBash).not.toHaveBeenCalled();
  });

  it("answers 404 when missing and 409 when closed or full", async () => {
    server.joinBash.mockResolvedValue("missing");
    expect((await join(none, params())).status).toBe(404);
    server.joinBash.mockResolvedValue("ended");
    expect((await join(none, params())).status).toBe(409);
    server.joinBash.mockResolvedValue("full");
    expect((await join(none, params())).status).toBe(409);
  });
});

describe("POST /api/bashes/[code]/start", () => {
  it("refuses anyone who is signed out", async () => {
    session.userId = null;
    expect((await start(none, params())).status).toBe(401);
    expect(server.startBash).not.toHaveBeenCalled();
  });

  it("starts the caller's own time", async () => {
    expect((await start(none, params())).status).toBe(200);
    expect(server.startBash).toHaveBeenCalledWith("user_1", CODE);
  });

  it("answers 409 before it opens, after it closed, and when full; 404 when missing", async () => {
    for (const why of ["upcoming", "ended", "full"] as const) {
      server.startBash.mockResolvedValue(why);
      const res = await start(none, params());
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(why);
    }
    server.startBash.mockResolvedValue("missing");
    expect((await start(none, params())).status).toBe(404);
    expect((await start(none, params("nope"))).status).toBe(404);
  });
});

describe("POST /api/bashes/[code]/leave", () => {
  it("refuses anyone who is signed out", async () => {
    session.userId = null;
    expect((await leave(none, params())).status).toBe(401);
    expect(server.leaveBash).not.toHaveBeenCalled();
  });

  it("leaves under the caller's id", async () => {
    expect((await leave(none, params())).status).toBe(200);
    expect(server.leaveBash).toHaveBeenCalledWith("user_1", CODE);
  });

  it("answers 409 once their time has started, and 404 when missing", async () => {
    server.leaveBash.mockResolvedValue("started");
    expect((await leave(none, params())).status).toBe(409);
    server.leaveBash.mockResolvedValue("missing");
    expect((await leave(none, params())).status).toBe(404);
  });
});

describe("POST /api/bashes/[code]/end", () => {
  it("refuses anyone who is signed out", async () => {
    session.userId = null;
    expect((await end(none, params())).status).toBe(401);
    expect(server.endBash).not.toHaveBeenCalled();
  });

  it("closes it under the caller's id", async () => {
    expect((await end(none, params())).status).toBe(200);
    expect(server.endBash).toHaveBeenCalledWith("user_1", CODE);
  });

  it("answers 404 to anyone who didn't create it", async () => {
    server.endBash.mockResolvedValue("missing");
    expect((await end(none, params())).status).toBe(404);
  });
});
