import { describe, expect, test } from "vitest";
import { briefPhase, claimCheckpoint, claimFiling, FilingStopped, FILING_CLAIM_TTL_MS, stopFiling } from "./brief-filing";

/** A brief row with only the fields the phase machine reads. */
const row = (over: Partial<Parameters<typeof briefPhase>[0]> = {}) => ({
  status: "processing",
  ticket_body: null,
  ticket_url: null,
  filing_started_at: null,
  ...over,
});

describe("briefPhase", () => {
  test("a capture being written up (no filing claim, no body) is 'writing'", () => {
    expect(briefPhase(row({ status: "processing" }))).toBe("writing");
    expect(briefPhase(row({ status: "uploaded" }))).toBe("writing");
  });

  test("a capture being FILED straight to the tracker is 'filing', not 'writing'", () => {
    // The bug: /process files directly, leaving status=processing with no body.
    // Read as 'writing', the page streams a draft over it and re-offers Export -
    // which files a SECOND ticket.
    expect(
      briefPhase(row({ status: "processing", filing_started_at: "2026-09-07T10:00:00.000Z" })),
    ).toBe("filing");
  });

  test("an export of a written draft is 'filing'", () => {
    expect(
      briefPhase(
        row({ status: "processing", ticket_body: "# Bug", filing_started_at: "2026-09-07T10:00:00.000Z" }),
      ),
    ).toBe("filing");
  });

  test("a written, unfiled draft is 'draft'", () => {
    expect(briefPhase(row({ status: "drafted", ticket_body: "# Bug" }))).toBe("draft");
  });

  test("a brief that already has a tracker ticket is 'filed', whatever the status says", () => {
    // A stale/clobbered row (status left at 'drafted' while the ticket exists)
    // must never be exportable again.
    expect(briefPhase(row({ status: "drafted", ticket_url: "https://linear.app/x/issue/ENG-1" }))).toBe(
      "filed",
    );
    expect(briefPhase(row({ status: "filed" }))).toBe("filed");
    // Ticket created, then the run threw before the row updated and the orphan
    // sweep marked it failed: a Linear ticket exists, so it IS filed.
    expect(briefPhase(row({ status: "failed", ticket_url: "https://linear.app/x/issue/ENG-1" }))).toBe(
      "filed",
    );
  });

  test("a failed brief with no ticket is 'failed'", () => {
    expect(briefPhase(row({ status: "failed" }))).toBe("failed");
  });

  test("an unknown status is 'unknown'", () => {
    expect(briefPhase(row({ status: "banana" }))).toBe("unknown");
  });
});

/** Records the PostgREST filter chain so the guard can be asserted. */
function fakeClient(returned: { id: string } | null) {
  const calls: { values?: Record<string, unknown>; filters: Array<[string, ...unknown[]]> } = {
    filters: [],
  };
  const builder: Record<string, unknown> = {};
  for (const op of ["eq", "is", "not", "or", "in", "lt", "select"]) {
    builder[op] = (...args: unknown[]) => {
      calls.filters.push([op, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = async () => ({ data: returned, error: null });
  builder.update = (values: Record<string, unknown>) => {
    calls.values = values;
    return builder;
  };
  return {
    client: { from: () => builder } as never,
    calls,
  };
}

describe("claimFiling", () => {
  test("claims the brief and stamps the filing start", async () => {
    const { client, calls } = fakeClient({ id: "b1" });

    expect(await claimFiling(client, "user_1", "b1")).toBe(true);

    expect(calls.values?.status).toBe("processing");
    expect(typeof calls.values?.filing_started_at).toBe("string");
  });

  test("refuses when the update matches nothing (already filed or already filing)", async () => {
    const { client } = fakeClient(null);
    expect(await claimFiling(client, "user_1", "b1")).toBe(false);
  });

  test("only claims a brief with no ticket and no live claim", async () => {
    const { client, calls } = fakeClient({ id: "b1" });
    await claimFiling(client, "user_1", "b1");

    // Never file on top of an existing ticket.
    expect(calls.filters).toContainEqual(["is", "ticket_url", null]);
    // Never file while another run holds the claim - unless it's gone stale.
    const or = calls.filters.find((f) => f[0] === "or")?.[1] as string;
    expect(or).toContain("filing_started_at.is.null");
    expect(or).toContain("filing_started_at.lt.");
    const cutoff = Date.parse(or.split("filing_started_at.lt.")[1]);
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(FILING_CLAIM_TTL_MS - 1000);
  });

  test("carries an extra patch (share_id, title) into the same atomic claim", async () => {
    const { client, calls } = fakeClient({ id: "b1" });
    await claimFiling(client, "user_1", "b1", { share_id: "abc" });
    expect(calls.values?.share_id).toBe("abc");
  });
});

/** A client whose successive maybeSingle() calls answer from `answers`, recording each update. */
function scriptedClient(answers: Array<Record<string, unknown> | null>) {
  const updates: Array<{ values: Record<string, unknown>; filters: Array<[string, ...unknown[]]> }> = [];
  let current: { values: Record<string, unknown>; filters: Array<[string, ...unknown[]]> } | null = null;
  const builder: Record<string, unknown> = {};
  for (const op of ["eq", "is", "not", "or", "select"]) {
    builder[op] = (...args: unknown[]) => {
      current?.filters.push([op, ...args]);
      return builder;
    };
  }
  builder.update = (values: Record<string, unknown>) => {
    current = { values, filters: [] };
    updates.push(current);
    return builder;
  };
  builder.maybeSingle = async () => ({ data: answers.shift() ?? null, error: null });
  return { client: { from: () => builder } as never, updates };
}

describe("stopFiling", () => {
  test("an Export being filed goes back to its draft", async () => {
    const { client, updates } = scriptedClient([{ id: "b1" }]);
    expect(await stopFiling(client, "user_1", "b1")).toBe("drafted");
    expect(updates[0].values).toMatchObject({ status: "drafted", filing_started_at: null });
    expect(updates[0].filters).toContainEqual(["or", "ticket_body.not.is.null"]);
  });

  test("a ticket sent from the extension shows as not filed, with Retry", async () => {
    const { client, updates } = scriptedClient([null, { id: "b1" }]);
    expect(await stopFiling(client, "user_1", "b1")).toBe("failed");
    expect(updates[1].values).toMatchObject({ status: "failed", filing_started_at: null, error: "Stopped before it was filed" });
    expect(updates[1].filters).toContainEqual(["or", "ticket_body.is.null"]);
  });

  test("only stops a filing with no ticket yet", async () => {
    const { client, updates } = scriptedClient([null, null]);
    expect(await stopFiling(client, "user_1", "b1")).toBeNull();
    for (const u of updates) {
      expect(u.filters).toContainEqual(["is", "ticket_url", null]);
      expect(u.filters).toContainEqual(["eq", "status", "processing"]);
      expect(u.filters).toContainEqual(["not", "filing_started_at", "is", null]);
    }
  });
});

describe("claimCheckpoint", () => {
  const claim = "2026-11-27T10:00:00.000Z";
  const reader = (data: Record<string, unknown> | null) =>
    ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data }) }) }) }) }) as never;

  test("goes on while the run's own claim is on the row", async () => {
    // Postgres hands the timestamp back in its own format: same instant, same claim.
    await expect(claimCheckpoint(reader({ filing_started_at: "2026-11-27T10:00:00+00:00", ticket_url: null }), "b1", claim)()).resolves.toBeUndefined();
  });

  test("stops once Stop cleared the claim", async () => {
    await expect(claimCheckpoint(reader({ filing_started_at: null, ticket_url: null }), "b1", claim)()).rejects.toBeInstanceOf(FilingStopped);
  });

  test("stops when another run took the claim, or a ticket already exists", async () => {
    await expect(claimCheckpoint(reader({ filing_started_at: "2026-11-27T10:05:00.000Z", ticket_url: null }), "b1", claim)()).rejects.toBeInstanceOf(FilingStopped);
    await expect(claimCheckpoint(reader({ filing_started_at: claim, ticket_url: "https://x/1" }), "b1", claim)()).rejects.toBeInstanceOf(FilingStopped);
  });
});
