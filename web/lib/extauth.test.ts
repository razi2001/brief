import { beforeEach, describe, it, expect, vi } from "vitest";

// briefs and extension_tokens, as the two queries in lastBriefAt read them
const db = vi.hoisted(() => ({ newest: null as string | null, paired: null as string | null, asked: [] as string[] }));
vi.mock("./supabase/server", () => ({
  createAdminSupabase: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: (col: string, v: string) => {
          db.asked.push(`${table}.${col}=${v}`);
          return q;
        },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => {
          const at = table === "briefs" ? db.newest : db.paired;
          return { data: at ? { created_at: at } : null, error: null };
        },
      };
      return q;
    },
  }),
}));

import { bearerFromHeader, lastBriefAt } from "./extauth";
import { hashToken } from "./tokens";

describe("bearerFromHeader", () => {
  it("extracts the token", () => {
    expect(bearerFromHeader("Bearer bxt_abc")).toBe("bxt_abc");
  });
  it("returns null when missing/malformed", () => {
    expect(bearerFromHeader(null)).toBeNull();
    expect(bearerFromHeader("Basic xyz")).toBeNull();
    expect(bearerFromHeader("Bearer ")).toBeNull();
  });
});

describe("lastBriefAt", () => {
  beforeEach(() => {
    db.newest = null;
    db.paired = null;
    db.asked = [];
  });

  it("is the newest brief of this user", async () => {
    db.newest = "2026-10-01T09:00:00Z";
    db.paired = "2026-09-01T09:00:00Z";
    expect(await lastBriefAt("user_1", "bxt_abc")).toBe("2026-10-01T09:00:00Z");
    expect(db.asked).toEqual(["briefs.user_id=user_1", `extension_tokens.token_hash=${hashToken("bxt_abc")}`]);
  });

  it("is the pairing when they never made one", async () => {
    db.paired = "2026-09-01T09:00:00Z";
    expect(await lastBriefAt("user_1", "bxt_abc")).toBe("2026-09-01T09:00:00Z");
  });

  it("is null when neither is found", async () => {
    expect(await lastBriefAt("user_1", "bxt_abc")).toBeNull();
  });
});
