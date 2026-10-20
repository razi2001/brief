import { beforeEach, describe, expect, it, vi } from "vitest";

const inserts = vi.hoisted(() => ({ rows: [] as unknown[], fail: false }));
vi.mock("@/lib/supabase/server", () => ({
  createAdminSupabase: () => ({
    from: () => ({
      insert: async (row: unknown) => {
        inserts.rows.push(row);
        return { error: inserts.fail ? { message: "down" } : null };
      },
    }),
  }),
}));
const afterMode = vi.hoisted(() => ({ throws: false }));
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    if (afterMode.throws) throw new Error("outside a request");
    return fn();
  },
}));

import { cleanProps, parseClientEvent, track } from "./events";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  inserts.rows = [];
  inserts.fail = false;
  afterMode.throws = false;
});

describe("cleanProps", () => {
  it("keeps flat scalars, caps strings, drops the rest", () => {
    expect(cleanProps({ a: "x".repeat(300), n: 3, b: true, o: { x: 1 }, u: undefined, z: null })).toEqual({
      a: "x".repeat(200),
      n: 3,
      b: true,
    });
  });

  it("keeps at most 12 keys", () => {
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(cleanProps(many))).toHaveLength(12);
  });
});

describe("track", () => {
  it("writes one row after the response", async () => {
    track("user_1", "tracker.connected", { provider: "linear" });
    await flush();
    expect(inserts.rows).toEqual([{ user_id: "user_1", name: "tracker.connected", props: { provider: "linear" } }]);
  });

  it("still writes outside a request", async () => {
    afterMode.throws = true;
    track(null, "site.view", { path: "/" });
    await flush();
    expect(inserts.rows).toHaveLength(1);
  });

  it("never throws when the insert fails", async () => {
    inserts.fail = true;
    expect(() => track("user_1", "brief.created")).not.toThrow();
    await flush();
  });
});

describe("parseClientEvent", () => {
  it("accepts the browser's names only", () => {
    expect(parseClientEvent({ name: "page.view", props: { path: "/tickets" } })).toEqual({
      name: "page.view",
      props: { path: "/tickets" },
    });
    expect(parseClientEvent({ name: "brief.filed" })).toBeNull();
    expect(parseClientEvent("nope")).toBeNull();
  });
});
