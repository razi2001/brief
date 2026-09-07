import { describe, expect, test } from "vitest";
import { briefPhase, claimFiling, FILING_CLAIM_TTL_MS } from "./brief-filing";

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
  });

  test("a failed brief is 'failed'", () => {
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
  for (const op of ["eq", "is", "or", "in", "lt", "select"]) {
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
