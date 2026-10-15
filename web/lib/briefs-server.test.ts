import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// attachTicketInfo is provider-agnostic: it groups filed rows by tracker and
// asks each one for live state through the registry. So the registry is the
// seam that gets mocked - a fake Tracker stands in for whichever provider the
// rows belong to, and the test exercises the real grouping, deletion and
// snapshot write-back logic without depending on any one adapter's internals.
vi.mock("@/lib/trackers/registry", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/trackers/registry")>();
  return {
    ...mod,
    resolveConnectedTrackers: vi.fn(),
  };
});
import { attachTicketInfo, DELETED_STATE, type BriefRow } from "@/lib/briefs-server";
import { resolveConnectedTrackers } from "@/lib/trackers/registry";
import type { LiveIssueLookup, ProviderKey, Tracker } from "@/lib/tracker";

/** Records the identifiers each live read was asked for. */
const lookup = vi.fn<(ids: string[]) => Promise<LiveIssueLookup>>();

vi.mocked(resolveConnectedTrackers).mockImplementation(async (_userId, keys) => {
  const map = new Map<ProviderKey, Tracker>();
  for (const key of keys) {
    map.set(key, { getLiveIssues: lookup } as unknown as Tracker);
  }
  return map;
});
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
    ticket_provider: "linear",
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
          createdAt: "2026-08-17T10:10:52.000Z",
          assignee: { name: "Ons" },
        },
      },
      gone: [],
    });
    const { admin, patches } = fakeAdmin();

    const [out] = await attachTicketInfo("user_1", [filedRow()], ["linear"], 60, admin);

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

    const [out] = await attachTicketInfo("user_1", [filedRow()], ["linear"], 60, admin);

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
      ["linear"],
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

    const first = await attachTicketInfo("user_1", rows, ["linear"], 60, admin);
    const second = await attachTicketInfo("user_1", rows, ["linear"], 60, admin);

    // First sight: the deleted one is verified live. Within the hour: only the
    // live ticket is asked for; the deleted row still renders as deleted.
    expect(lookup.mock.calls.map((c) => c[0])).toEqual([["APP-9001", "APP-9002"], ["APP-9002"]]);
    expect(first[0].ticket?.deleted).toBe(true);
    expect(second[0].ticket?.deleted).toBe(true);
  });

  it("falls back to the last snapshot, unchanged, when the live sync misses", async () => {
    lookup.mockResolvedValue({ issues: {}, gone: [] });
    const { admin, patches } = fakeAdmin();

    const [out] = await attachTicketInfo("user_1", [filedRow()], ["linear"], 60, admin);

    expect(out.ticket?.stateName).toBe("Triage");
    expect(out.ticket?.deleted).toBeUndefined();
    expect(out.ticket_identifier).toBe("APP-5342");
    expect(patches).toEqual([]);
  });

  it("only asks a Jira tracker about tickets filed on its own site", async () => {
    // The user now files into beta; a ticket filed on acme has a key beta may
    // also use, for a different issue.
    vi.mocked(resolveConnectedTrackers).mockImplementationOnce(async () => {
      const map = new Map<ProviderKey, Tracker>();
      map.set("jira", { getLiveIssues: lookup, site: "https://beta.atlassian.net" } as unknown as Tracker);
      return map;
    });
    const live = (title: string) => ({
      title,
      url: "https://beta.atlassian.net/browse/ABC-1",
      stateName: "Done",
      stateColor: "#00875a",
      createdAt: "",
    });
    lookup.mockResolvedValue({ issues: { "ABC-1": live("Beta's own issue"), "ABC-2": live("Filed on beta") }, gone: [] });
    const jiraRow = (id: string, host: string, key: string) =>
      filedRow({
        id,
        ticket_provider: "jira",
        ticket_identifier: key,
        ticket_url: `https://${host}/browse/${key}`,
        ticket_title: "Snapshot title",
        ticket_state_name: "To Do",
      });
    const { admin, patches } = fakeAdmin();

    const [onAcme, onBeta, noUrl] = await attachTicketInfo(
      "user_1",
      [jiraRow("a", "acme.atlassian.net", "ABC-1"), jiraRow("b", "beta.atlassian.net", "ABC-2"), { ...jiraRow("c", "", "ABC-3"), ticket_url: null }],
      ["jira"],
      60,
      admin,
    );

    expect(lookup).toHaveBeenCalledWith(["ABC-2"]);
    // The acme ticket keeps its snapshot, and beta's ABC-1 is never written over it.
    expect(onAcme.ticket?.title).toBe("Snapshot title");
    expect(onAcme.ticket?.stateName).toBe("To Do");
    expect(onBeta.ticket?.title).toBe("Filed on beta");
    expect(noUrl.ticket?.stateName).toBe("To Do");
    expect(patches.map((x) => x.id)).toEqual(["b"]);
  });
});
