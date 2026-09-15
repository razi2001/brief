import { describe, it, expect, vi, beforeEach } from "vitest";

const resolve = {
  linear: vi.fn(),
  jira: vi.fn(),
  github: vi.fn(),
};

vi.mock("@/lib/trackers/registry", () => ({
  PROVIDERS: [
    { key: "linear", name: "Linear", resolve: (u: string) => resolve.linear(u) },
    { key: "jira", name: "Jira", resolve: (u: string) => resolve.jira(u) },
    { key: "github", name: "GitHub", resolve: (u: string) => resolve.github(u) },
  ],
}));

const { checkTrackerHealth } = await import("./tracker-health");

beforeEach(() => {
  resolve.linear.mockReset();
  resolve.jira.mockReset();
  resolve.github.mockReset();
});

describe("checkTrackerHealth", () => {
  it("reports nothing stale when the tracker resolves", async () => {
    resolve.linear.mockResolvedValue({ kind: "linear" });
    expect(await checkTrackerHealth("u1", ["linear"])).toEqual({ stale: [] });
  });

  it("flags a tracker Clerk calls connected but cannot vend a token for", async () => {
    // The real shape of the bug: the account record says verified, the token
    // endpoint answers 400, so resolve() comes back null.
    resolve.linear.mockResolvedValue(null);
    expect(await checkTrackerHealth("u1", ["linear"])).toEqual({ stale: ["linear"] });
  });

  it("flags a tracker whose lookup throws - it can't file either", async () => {
    resolve.linear.mockRejectedValue(new Error("network"));
    expect(await checkTrackerHealth("u1", ["linear"])).toEqual({ stale: ["linear"] });
  });

  it("checks each connected tracker independently", async () => {
    resolve.linear.mockResolvedValue({ kind: "linear" });
    resolve.jira.mockResolvedValue(null);
    expect(await checkTrackerHealth("u1", ["linear", "jira"])).toEqual({ stale: ["jira"] });
  });

  it("never probes a tracker the user hasn't connected", async () => {
    resolve.linear.mockResolvedValue({ kind: "linear" });
    await checkTrackerHealth("u1", ["linear"]);
    expect(resolve.jira).not.toHaveBeenCalled();
    expect(resolve.github).not.toHaveBeenCalled();
  });

  it("does nothing for a user with no trackers at all", async () => {
    expect(await checkTrackerHealth("u1", [])).toEqual({ stale: [] });
    expect(resolve.linear).not.toHaveBeenCalled();
  });
});
