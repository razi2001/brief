import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: "user_1" as string | null }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: session.userId }) }));

const events = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@/lib/events", () => events);

/** Every row the route tried to insert, and what each attempt answers. */
const db = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  answers: [] as Array<{ error: { code?: string; message?: string } | null }>,
}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminSupabase: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        expect(table).toBe("briefs");
        db.inserts.push(row);
        const answer = db.answers.shift() ?? { error: null };
        const chain = {
          select: () => chain,
          single: async () =>
            answer.error ? { data: null, error: answer.error } : { data: { share_id: row.share_id }, error: null },
        };
        return chain;
      },
    }),
  }),
}));

import { POST } from "./route";

beforeEach(() => {
  session.userId = "user_1";
  db.inserts = [];
  db.answers = [];
  events.track.mockClear();
});

describe("starting a blank draft", () => {
  it("creates a written-up draft with nothing in it and answers its share link", async () => {
    const res = await POST();

    expect(res.status).toBe(200);
    expect(db.inserts).toHaveLength(1);
    const row = db.inserts[0];
    expect(row).toMatchObject({ user_id: "user_1", status: "drafted", source_kind: "text" });
    expect(row.storage_prefix).toBe(`user_1/${row.id}`);
    expect(row.share_id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(row).not.toHaveProperty("ticket_title");
    expect(row).not.toHaveProperty("ticket_body");
    expect(await res.json()).toEqual({ shareId: row.share_id });
    expect(events.track).toHaveBeenCalledWith("user_1", "brief.created", { kind: "blank" });
  });

  it("takes a fresh link when the first one is already a brief's", async () => {
    db.answers = [{ error: { code: "23505" } }];

    const res = await POST();

    expect(db.inserts).toHaveLength(2);
    expect(db.inserts[1].share_id).not.toBe(db.inserts[0].share_id);
    expect(await res.json()).toEqual({ shareId: db.inserts[1].share_id });
  });

  it("refuses without a session", async () => {
    session.userId = null;

    const res = await POST();

    expect(res.status).toBe(401);
    expect(db.inserts).toHaveLength(0);
  });

  it("reports a failed insert", async () => {
    db.answers = [{ error: { message: "db down" } }];

    const res = await POST();

    expect(res.status).toBe(500);
    expect(events.track).not.toHaveBeenCalled();
  });
});
