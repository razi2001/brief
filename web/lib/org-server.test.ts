import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setOrgSettings, getOrgSettings, getOrgMemberIds } from "./org-server";

/**
 * A stub Supabase client. The real one RESOLVES with `{ error }` rather than
 * rejecting, which is exactly the behaviour these tests pin down: code that
 * only wraps a call in try/catch never learns that the write failed.
 */
function stubDb(result: { data?: unknown; error?: { message: string } | null }) {
  const settled = { data: result.data ?? null, error: result.error ?? null };
  const upsert = vi.fn().mockResolvedValue({ error: settled.error });
  // `.eq(...)` is both awaitable (getOrgMemberIds) and further chainable into
  // `.maybeSingle()` (getOrgSettings), which is how the real query builder
  // behaves - so the stub is a thenable that also carries maybeSingle.
  const eqResult = {
    maybeSingle: vi.fn().mockResolvedValue(settled),
    then: (resolve: (v: typeof settled) => unknown) => Promise.resolve(settled).then(resolve),
  };
  const eq = vi.fn(() => eqResult);
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ upsert, select }));
  return { db: { from } as unknown as SupabaseClient, upsert, from };
}

const BY = { userId: "user_1", name: "Razi" };

describe("setOrgSettings", () => {
  it("writes the guidance with its author", async () => {
    const { db, upsert } = stubDb({ error: null });
    await setOrgSettings("linear:abc", "Status: Backlog.", BY, db);

    expect(upsert).toHaveBeenCalledTimes(1);
    const row = upsert.mock.calls[0][0];
    expect(row.org_key).toBe("linear:abc");
    expect(row.ticket_guidance).toBe("Status: Backlog.");
    expect(row.updated_by).toBe("user_1");
    expect(row.updated_by_name).toBe("Razi");
  });

  it("throws when the write fails, rather than reporting a save that never happened", async () => {
    const { db } = stubDb({ error: { message: "permission denied" } });
    await expect(
      setOrgSettings("linear:abc", "Status: Backlog.", BY, db),
    ).rejects.toThrow("permission denied");
  });
});

describe("getOrgSettings", () => {
  it("reads the stored guidance and who last changed it", async () => {
    const { db } = stubDb({
      data: {
        ticket_guidance: "Status: Triage.",
        updated_by_name: "Jonas",
        updated_at: "2026-09-02T10:00:00.000Z",
      },
    });
    const s = await getOrgSettings("linear:abc", db);
    expect(s.ticketGuidance).toBe("Status: Triage.");
    expect(s.updatedByName).toBe("Jonas");
    expect(s.updatedAt).toBe("2026-09-02T10:00:00.000Z");
  });

  it("degrades to empty for an org nobody has configured", async () => {
    const { db } = stubDb({ data: null });
    const s = await getOrgSettings("linear:abc", db);
    // The agent still has to be able to file when there is no guidance.
    expect(s).toEqual({ ticketGuidance: "", updatedByName: "", updatedAt: null });
  });
});

describe("getOrgMemberIds", () => {
  it("returns the ids in the org", async () => {
    const { db } = stubDb({ data: [{ user_id: "a" }, { user_id: "b" }] });
    expect(await getOrgMemberIds("linear:abc", db)).toEqual(["a", "b"]);
  });

  it("returns nothing for an org with no cached members", async () => {
    const { db } = stubDb({ data: null });
    expect(await getOrgMemberIds("linear:abc", db)).toEqual([]);
  });
});
