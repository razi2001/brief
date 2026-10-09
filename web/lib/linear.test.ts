import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getIssuesByIdentifiers, linearGraphQL, mapLinearSearchIssue } from "./linear";

describe("mapLinearSearchIssue", () => {
  it("maps a Linear issue node to an enriched search result", () => {
    const result = mapLinearSearchIssue({
      identifier: "AI-12",
      title: "Agent picks wrong team",
      url: "https://linear.app/acme/issue/AI-12",
      priority: 2, // high
      state: { name: "Todo" },
      assignee: { displayName: "Sam", name: "sam@acme.com" },
      labels: { nodes: [{ name: "area/agent" }, { name: "type/bug" }] },
      team: { name: "AI" },
      project: { name: "Routing" },
    });
    expect(result).toEqual({
      identifier: "AI-12",
      title: "Agent picks wrong team",
      url: "https://linear.app/acme/issue/AI-12",
      target: "AI",
      state: "Todo",
      labels: ["area/agent", "type/bug"],
      assignee: "Sam",
      priority: "high",
      project: "Routing",
    });
  });

  it("tolerates missing fields and unknown priority", () => {
    const result = mapLinearSearchIssue({ identifier: "X-1", title: "t", url: "u", priority: 0 });
    expect(result.target).toBe("");
    expect(result.labels).toEqual([]);
    expect(result.assignee).toBeUndefined();
    expect(result.priority).toBeUndefined();
    expect(result.project).toBeUndefined();
  });
});

// ── getIssuesByIdentifiers: the live sync behind the Tickets feed ────────────
// Linear's `issue(id:)` is declared non-null (`Issue!`), so when a requested
// ticket no longer exists Linear answers with an error for that alias AND
// `data: null` for the whole query. graphql-js resolves root fields with
// Promise.all, so only the FIRST failure is reported per response, however
// many tickets are missing. These tests replay that exact envelope.

const tok = { token: "test-token" };
const NOT_FOUND = "Entity not found: Issue - Could not find referenced Issue.";

function issueNode(identifier: string) {
  return {
    identifier,
    title: `Title of ${identifier}`,
    url: `https://linear.app/acme/issue/${identifier}/slug`,
    createdAt: "2026-07-01T00:00:00.000Z",
    state: { name: "Todo", color: "#3e955f", type: "unstarted" },
    assignee: { name: "Sam", avatarUrl: "https://img/sam.png" },
  };
}

/** The identifiers a request asked for, in alias order (i0, i1, …). */
function requestedIds(init: RequestInit | undefined): string[] {
  const query = (JSON.parse(String(init?.body)) as { query: string }).query;
  return [...query.matchAll(/issue\(id: "([^"]+)"\)/g)].map((m) => m[1]);
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** A Linear stand-in: every identifier in `deleted` is gone; like graphql-js it
 *  reports only the first missing alias per response, with `data: null`. */
function linearWithDeleted(deleted: Iterable<string>) {
  const gone = new Set(deleted);
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const ids = requestedIds(init);
    const firstGone = ids.findIndex((id) => gone.has(id));
    if (firstGone !== -1) {
      return json({
        errors: [{ message: NOT_FOUND, path: [`i${firstGone}`], extensions: { type: "invalid input", userError: true } }],
        data: null,
      });
    }
    const data: Record<string, unknown> = {};
    ids.forEach((id, i) => (data[`i${i}`] = issueNode(id)));
    return json({ data });
  });
}

describe("getIssuesByIdentifiers", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("still returns every live ticket when one identifier no longer exists in Linear", async () => {
    const fetchMock = linearWithDeleted(["APP-4690"]);
    vi.stubGlobal("fetch", fetchMock);

    const { issues, gone } = await getIssuesByIdentifiers(tok, ["APP-5862", "APP-4690", "APP-5784"]);

    expect(Object.keys(issues).sort()).toEqual(["APP-5784", "APP-5862"]);
    expect(issues["APP-5784"].stateName).toBe("Todo");
    expect(issues["APP-5784"].assignee).toEqual({ name: "Sam", avatarUrl: "https://img/sam.png" });
    expect(gone).toEqual(["APP-4690"]);
    // One round-trip to learn which alias is gone, one to re-ask without it.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedIds(fetchMock.mock.calls[1][1])).toEqual(["APP-5862", "APP-5784"]);
  });

  it("keeps going when several tickets are gone and Linear reports them one per response", async () => {
    const fetchMock = linearWithDeleted(["APP-4690", "AI-2337"]);
    vi.stubGlobal("fetch", fetchMock);

    const { issues, gone } = await getIssuesByIdentifiers(tok, [
      "APP-5862",
      "APP-4690",
      "APP-5784",
      "AI-2337",
      "APP-5776",
    ]);

    expect(Object.keys(issues).sort()).toEqual(["APP-5776", "APP-5784", "APP-5862"]);
    expect([...gone].sort()).toEqual(["AI-2337", "APP-4690"]);
    // One round per deletion, then the clean one.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps a deletion inside its own chunk of 20", async () => {
    const ids = Array.from({ length: 21 }, (_, n) => `APP-${1000 + n}`);
    const fetchMock = linearWithDeleted(["APP-1005"]);
    vi.stubGlobal("fetch", fetchMock);

    const { issues, gone } = await getIssuesByIdentifiers(tok, ids);

    expect(Object.keys(issues)).toHaveLength(20);
    expect(gone).toEqual(["APP-1005"]);
    // chunk 1: learn + re-ask; chunk 2: one clean request.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestedIds(fetchMock.mock.calls[2][1])).toEqual(["APP-1020"]);
  });

  it("does not call a ticket deleted when a field below it failed", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const ids = requestedIds(init);
        if (calls++ === 0) {
          return json({ errors: [{ message: "Something broke", path: ["i1", "state"] }], data: null });
        }
        const data: Record<string, unknown> = {};
        ids.forEach((id, i) => (data[`i${i}`] = issueNode(id)));
        return json({ data });
      }),
    );

    const { issues, gone } = await getIssuesByIdentifiers(tok, ["APP-1", "APP-2", "APP-3"]);

    // APP-2 keeps its snapshot for this load; it is NOT reported as gone.
    expect(Object.keys(issues).sort()).toEqual(["APP-1", "APP-3"]);
    expect(gone).toEqual([]);
  });

  it("stops after the round budget and leaves the rest to their snapshots", async () => {
    const ids = Array.from({ length: 8 }, (_, n) => `APP-${n}`);
    // Seven of eight are gone: more deletions than rounds.
    const fetchMock = linearWithDeleted(ids.slice(0, 7));
    vi.stubGlobal("fetch", fetchMock);

    const { issues, gone } = await getIssuesByIdentifiers(tok, ids);

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(gone).toHaveLength(6);
    expect(issues).toEqual({});
  });

  it("keys a ticket that moved teams by the identifier we asked for, carrying its new one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const data: Record<string, unknown> = {};
        requestedIds(init).forEach((id, i) => {
          data[`i${i}`] = issueNode(id === "APP-5342" ? "AI-2652" : id);
        });
        return json({ data });
      }),
    );

    const { issues, gone } = await getIssuesByIdentifiers(tok, ["APP-5342", "APP-5862"]);

    expect(issues["APP-5342"]?.identifier).toBe("AI-2652");
    expect(issues["APP-5342"]?.url).toBe("https://linear.app/acme/issue/AI-2652/slug");
    expect(issues["APP-5862"]?.identifier).toBe("APP-5862");
    expect(issues["AI-2652"]).toBeUndefined();
    expect(gone).toEqual([]);
  });

  it("gives up on the batch, without throwing, when the error isn't about one ticket", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ errors: [{ message: "Rate limit exceeded", extensions: { type: "ratelimited" } }], data: null }),
      ),
    );

    await expect(getIssuesByIdentifiers(tok, ["APP-1", "APP-2"])).resolves.toEqual({ issues: {}, gone: [] });
  });
});

describe("linearGraphQL on a failed or empty response", () => {
  afterEach(() => vi.unstubAllGlobals());
  const tk = { kind: "oauth" as const, token: "t" };

  it("names a rate limit instead of returning nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Too Many Requests", { status: 429 })));
    await expect(linearGraphQL(tk, "query { viewer { id } }", {})).rejects.toThrow(/rate-limiting/);
  });

  it("names an outage page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })));
    await expect(linearGraphQL(tk, "query { viewer { id } }", {})).rejects.toThrow("Linear API error 502");
  });

  it("refuses an empty answer rather than handing back null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: null }), { status: 200 })));
    await expect(linearGraphQL(tk, "query { viewer { id } }", {})).rejects.toThrow(/empty response/);
  });
});
