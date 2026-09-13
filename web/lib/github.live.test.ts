import { afterEach, describe, expect, it, vi } from "vitest";
import { makeGithubTracker } from "@/lib/github";

/**
 * Regression cover for the bug that silently froze the GitHub tickets feed.
 *
 * The live-read query asked for a Projects v2 Status field. That needs
 * `read:project`, which Brief does not request - and GitHub answers a query
 * touching a field the token can't read with `data: null` plus an
 * INSUFFICIENT_SCOPES error, rejecting the WHOLE query. Every sync therefore
 * returned nothing: no status changes, and deleted tickets still showing Open.
 */

const INSUFFICIENT = {
  data: null,
  errors: [
    {
      type: "INSUFFICIENT_SCOPES",
      message: "Your token has not been granted the required scopes to execute this query.",
    },
  ],
};

function mockGraphQL(responder: (query: string) => unknown) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const query = JSON.parse(String(init.body)).query as string;
      calls.push(query);
      return { ok: true, status: 200, json: async () => responder(query) } as unknown as Response;
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("getLiveIssues survives a token without read:project", () => {
  it("retries without the board field and still reports a deleted issue", async () => {
    const calls = mockGraphQL((q) =>
      q.includes("projectItems")
        ? INSUFFICIENT
        : { data: { i0: { issue: null } } },
    );

    const out = await makeGithubTracker({ token: "t" }).getLiveIssues(["acme/web#1"]);

    // Before the fix this was [] - the deletion was invisible forever.
    expect(out.gone).toEqual(["acme/web#1"]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("projectItems");
    expect(calls[1]).not.toContain("projectItems");
  });

  it("stops asking for the board field once refused, across batches", async () => {
    const calls = mockGraphQL((q) =>
      q.includes("projectItems")
        ? INSUFFICIENT
        : {
            data: {
              i0: { issue: { number: 1, title: "A", url: "u", state: "OPEN", createdAt: "t" } },
            },
          },
    );

    const tracker = makeGithubTracker({ token: "t" });
    await tracker.getLiveIssues(["acme/web#1"]);
    await tracker.getLiveIssues(["acme/web#1"]);

    // First read costs the doomed attempt plus the retry; the second read
    // should go straight to the query that works.
    expect(calls).toHaveLength(3);
    expect(calls[2]).not.toContain("projectItems");
  });

  it("reads the board status when the token does carry the scope", async () => {
    mockGraphQL(() => ({
      data: {
        i0: {
          issue: {
            number: 1,
            title: "Save fails",
            url: "https://github.com/acme/web/issues/1",
            state: "OPEN",
            createdAt: "2026-09-13T00:00:00Z",
            projectItems: { nodes: [{ fieldValueByName: { name: "In review" } }] },
          },
        },
      },
    }));

    const out = await makeGithubTracker({ token: "t" }).getLiveIssues(["acme/web#1"]);
    expect(out.issues["acme/web#1"].stateName).toBe("In review");
    expect(out.gone).toEqual([]);
  });

  it("leaves `gone` alone when the whole call fails, so an outage is not a deletion", async () => {
    mockGraphQL(() => ({ data: null, errors: [{ type: "SERVICE_UNAVAILABLE" }] }));
    const out = await makeGithubTracker({ token: "t" }).getLiveIssues(["acme/web#1"]);
    expect(out.gone).toEqual([]);
    expect(Object.keys(out.issues)).toEqual([]);
  });
});
