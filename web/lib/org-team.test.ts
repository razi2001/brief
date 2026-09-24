import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { getUserList } = vi.hoisted(() => ({ getUserList: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ users: { getUserList } }),
}));

import { getOrgTeam } from "./org-server";

/** org_members for the roster, the org_leaderboard RPC for the counts. */
function stubDb(memberIds: string[], rows: Array<Record<string, string | number>>) {
  const eq = vi
    .fn()
    .mockResolvedValue({ data: memberIds.map((user_id) => ({ user_id })), error: null });
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
  return { db: { from, rpc } as unknown as SupabaseClient, rpc };
}

beforeEach(() => {
  getUserList.mockResolvedValue({
    data: [
      { id: "u1", firstName: "Razi", lastName: "Fezzani", imageUrl: "https://img.test/u1" },
      { id: "u2", firstName: "jonas", lastName: "Weber" },
      { id: "u3", firstName: "Ana", lastName: null },
    ],
  });
});

const ROWS = [
  { user_id: "u2", filed: 31, night: 0, avg_title: 40, prev_filed: 10 },
  { user_id: "u1", filed: 44, night: 2, avg_title: 30, prev_filed: 40 },
];

describe("getOrgTeam", () => {
  it("lists everyone in the org, you first, then by name", async () => {
    const { db } = stubDb(["u1", "u2", "u3"], ROWS);
    const team = await getOrgTeam("linear:acme", "u1", db);
    expect(team.map((x) => x.fullName)).toEqual(["Razi Fezzani", "Ana", "jonas Weber"]);
    expect(team[0].isYou).toBe(true);
    expect(team[0].imageUrl).toBe("https://img.test/u1");
  });

  it("keeps a member who has filed nothing, at zero", async () => {
    const { db } = stubDb(["u1", "u2", "u3"], ROWS);
    const team = await getOrgTeam("linear:acme", "u1", db);
    expect(team.find((x) => x.userId === "u3")?.filed).toBe(0);
  });

  it("carries the titles the podium hands out", async () => {
    const { db } = stubDb(["u1", "u2", "u3"], ROWS);
    const team = await getOrgTeam("linear:acme", "u1", db);
    expect(team.find((x) => x.userId === "u1")?.title).toBe("chief bug officer");
    expect(team.find((x) => x.userId === "u3")?.title).toBe("still warming up");
  });

  it("counts all time", async () => {
    const { db, rpc } = stubDb(["u1", "u2", "u3"], ROWS);
    await getOrgTeam("linear:acme", "u1", db);
    expect(rpc).toHaveBeenCalledWith("org_leaderboard", {
      member_ids: ["u1", "u2", "u3"],
      since: null,
    });
  });

  it("is empty for an org with no members", async () => {
    const { db, rpc } = stubDb([], []);
    expect(await getOrgTeam("linear:acme", "u1", db)).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});
