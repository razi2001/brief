import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// The live lookup is mocked; everything else in briefs-server runs for real.
vi.mock("@/lib/linear", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/linear")>();
  return {
    ...mod,
    getLinearToken: vi.fn(async () => ({ token: "test-token" })),
    getIssuesByIdentifiers: vi.fn(),
  };
});

import { attachTicketInfo, DELETED_STATE, type BriefRow } from "@/lib/briefs-server";
import { getIssuesByIdentifiers } from "@/lib/linear";

const lookup = vi.mocked(getIssuesByIdentifiers);
const DELETED_COLOR = "#c9c3b5";

function filedRow(overrides: Partial<BriefRow> = {}): BriefRow {
  return {
    id: "brief-1",
    status: "filed",
    title: "Brief name",
    source_kind: "recording",
    created_at: "2026-08-17T10:09:37.000Z",
    updated_at: null,
    ticket_url: "https://linear.app/acme/issue/APP-5342/old-title",
    ticket_identifier: "APP-5342",
    ticket_title: "Old title",
    ticket_state_name: "Triage",
    ticket_state_color: "#FC7840",
    share_id: "share-1",
    error: null,
    archived_at: null,
    seq: 7,
    ...overrides,
  };
}

/** A Supabase stand-in that records every snapshot write-back. */
function fakeAdmin() {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const admin = {
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: (_column: string, id: string) => {
          patches.push({ id, patch });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  } as unknown as SupabaseClient;
  return { admin, patches };
}

describe("attachTicketInfo", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    lookup.mockReset();
  });

  it("follows a ticket that moved teams: live state, new id and url, snapshot written back", async () => {
    lookup.mockResolvedValue({
      issues: {
        "APP-5342": {
          identifier: "AI-2652",
          title: "New title",
          url: "https://linear.app/acme/issue/AI-2652/new-title",
          stateName: "Done",
          stateColor: "#5e6ad2",
          stateType: "completed",
          createdAt: "2026-08-17T10:10:52.000Z",
          assignee: { name: "Ons" },
        },
      },
      gone: [],
    });
    const { admin, patches } = fakeAdmin();

    const [out] = await attachTicketInfo("user_1", [filedRow()], true, false, 60, admin);

    expect(out.ticket_identifier).toBe("AI-2652");
    expect(out.ticket_url).toBe("https://linear.app/acme/issue/AI-2652/new-title");
    expect(out.ticket?.title).toBe("New title");
    expect(out.ticket?.stateName).toBe("Done");
    expect(out.ticket?.assignee?.name).toBe("Ons");
    expect(out.ticket?.deleted).toBeUndefined();
    expect(patches).toEqual([
      {
        id: "brief-1",
        patch: {
          ticket_title: "New title",
          ticket_state_name: "Done",
          ticket_state_color: "#5e6ad2",
          ticket_identifier: "AI-2652",
          ticket_url: "https://linear.app/acme/issue/AI-2652/new-title",
        },
      },
    ]);
  });

  it("marks a ticket the tracker no longer has as deleted, and remembers that in the snapshot", async () => {
    lookup.mockResolvedValue({ issues: {}, gone: ["APP-5342"] });
    const { admin, patches } = fakeAdmin();

    const [out] = await attachTicketInfo("user_1", [filedRow()], true, false, 60, admin);

    expect(out.ticket?.deleted).toBe(true);
    expect(out.ticket?.stateName).toBe(DELETED_STATE);
    expect(out.ticket?.title).toBe("Old title");
    expect(out.ticket_identifier).toBe("APP-5342");
    expect(patches).toEqual([
      { id: "brief-1", patch: { ticket_state_name: DELETED_STATE, ticket_state_color: DELETED_COLOR } },
    ]);
  });

  it("keeps a remembered deletion when the tracker can't be reached", async () => {
    lookup.mockResolvedValue({ issues: {}, gone: [] });
    const { admin, patches } = fakeAdmin();

    const [out] = await attachTicketInfo(
      "user_1",
      [filedRow({ ticket_state_name: DELETED_STATE, ticket_state_color: DELETED_COLOR })],
      true,
      false,
      60,
      admin,
    );

    expect(out.ticket?.deleted).toBe(true);
    expect(out.ticket?.stateName).toBe(DELETED_STATE);
    expect(patches).toEqual([]);
    // First sight of this deletion: it was verified live, and Linear said nothing.
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("re-checks a remembered deletion now and then, not on every load", async () => {
    lookup.mockResolvedValue({ issues: {}, gone: [] });
    const { admin } = fakeAdmin();
    const rows = [
      filedRow({
        id: "brief-9",
        ticket_identifier: "APP-9001",
        ticket_url: "https://linear.app/acme/issue/APP-9001/gone",
        ticket_state_name: DELETED_STATE,
        ticket_state_color: DELETED_COLOR,
      }),
      filedRow({ id: "brief-8", ticket_identifier: "APP-9002", ticket_url: "https://linear.app/acme/issue/APP-9002/x" }),
    ];

    const first = await attachTicketInfo("user_1", rows, true, false, 60, admin);
    const second = await attachTicketInfo("user_1", rows, true, false, 60, admin);

    // First sight: the deleted one is verified live. Within the hour: only the
    // live ticket is asked for; the deleted row still renders as deleted.
    expect(lookup.mock.calls.map((c) => c[1])).toEqual([["APP-9001", "APP-9002"], ["APP-9002"]]);
    expect(first[0].ticket?.deleted).toBe(true);
    expect(second[0].ticket?.deleted).toBe(true);
  });

  it("falls back to the last snapshot, unchanged, when the live sync misses", async () => {
    lookup.mockResolvedValue({ issues: {}, gone: [] });
    const { admin, patches } = fakeAdmin();

    const [out] = await attachTicketInfo("user_1", [filedRow()], true, false, 60, admin);

    expect(out.ticket?.stateName).toBe("Triage");
    expect(out.ticket?.deleted).toBeUndefined();
    expect(out.ticket_identifier).toBe("APP-5342");
    expect(patches).toEqual([]);
  });
});
