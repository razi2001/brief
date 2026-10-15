import { describe, it, expect, vi, beforeEach } from "vitest";

// What each tracker's check answers; a key with no entry resolves fine.
const answers = vi.hoisted(() => new Map<string, unknown>());
const checkTracker = vi.hoisted(() => vi.fn());

vi.mock("@/lib/trackers/registry", () => ({ checkTracker }));

const { checkTrackerHealth } = await import("./tracker-health");

beforeEach(() => {
  answers.clear();
  checkTracker.mockReset();
  checkTracker.mockImplementation(async (_u: string, key: string) =>
    answers.has(key) ? answers.get(key) : { tracker: { kind: key } },
  );
});

const healthy = { stale: [], needsWorkspace: [], unavailable: [] };

describe("checkTrackerHealth", () => {
  it("reports nothing when the tracker resolves", async () => {
    expect(await checkTrackerHealth("u1", ["linear"])).toEqual(healthy);
  });

  it("flags a tracker Clerk calls connected but cannot vend a token for", async () => {
    // The real shape of the bug: the account record says verified, the token
    // endpoint answers 400, so the check comes back stale.
    answers.set("linear", { tracker: null, problem: "stale" });
    expect(await checkTrackerHealth("u1", ["linear"])).toEqual({ ...healthy, stale: ["linear"] });
  });

  it("checks each connected tracker independently", async () => {
    answers.set("jira", { tracker: null, problem: "stale" });
    expect(await checkTrackerHealth("u1", ["linear", "jira"])).toEqual({ ...healthy, stale: ["jira"] });
  });

  it("never probes a tracker the user hasn't connected", async () => {
    await checkTrackerHealth("u1", ["linear"]);
    expect(checkTracker.mock.calls.map(([, k]) => k)).toEqual(["linear"]);
  });

  it("does nothing for a user with no trackers at all", async () => {
    expect(await checkTrackerHealth("u1", [])).toEqual(healthy);
    expect(checkTracker).not.toHaveBeenCalled();
  });

  it("reports a connection waiting on its workspace pick apart from a stale one", async () => {
    // Azure DevOps with several organizations and none picked: reconnecting
    // would not help, so it must not read as expired.
    answers.set("linear", { tracker: null, problem: "stale" });
    answers.set("azure", { tracker: null, problem: "needsWorkspace" });
    expect(await checkTrackerHealth("u1", ["linear", "azure"])).toEqual({
      ...healthy,
      stale: ["linear"],
      needsWorkspace: ["azure"],
    });
  });

  it("reports a tracker this deployment can't file into apart from a stale one", async () => {
    answers.set("trello", { tracker: null, problem: "unavailable" });
    expect(await checkTrackerHealth("u1", ["trello"])).toEqual({ ...healthy, unavailable: ["trello"] });
  });

  it("checks each tracker exactly once", async () => {
    // The check that resolves is the one that explains a miss, so an owned
    // connection with a revoked grant is not refreshed a second time.
    answers.set("azure", { tracker: null, problem: "needsWorkspace" });
    await checkTrackerHealth("u1", ["azure"]);
    expect(checkTracker).toHaveBeenCalledTimes(1);
  });

  it("ignores a key the registry doesn't know", async () => {
    answers.set("linear", null);
    expect(await checkTrackerHealth("u1", ["linear"])).toEqual(healthy);
  });
});
