import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "user_1" }) }));

const workspaces = vi.hoisted(() => ({
  hasWorkspacePick: (p: string) => p === "gitlab",
  setPickedWorkspace: vi.fn<(...args: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true })),
  listWorkspaces: vi.fn(async () => []),
  getPickedWorkspace: vi.fn(async () => null),
}));
vi.mock("@/lib/workspaces", () => workspaces);

import { POST } from "./route";

const ORIGIN = "http://localhost:3000";

function pick(headers: Record<string, string>) {
  return POST(
    new NextRequest(`${ORIGIN}/api/org/workspace`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ provider: "gitlab", id: "42" }),
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("APP_URL", "");
  workspaces.setPickedWorkspace.mockClear();
});

describe("POST /api/org/workspace", () => {
  it("stores a pick made from the app's own pages", async () => {
    const res = await pick({ origin: ORIGIN });
    expect(await res.json()).toEqual({ ok: true });
    expect(workspaces.setPickedWorkspace).toHaveBeenCalledWith("user_1", "gitlab", "42");
  });

  // A form on another site would otherwise ride the session cookie and move
  // the user into whatever org it named.
  it.each([
    ["another origin", { origin: "https://evil.example" }],
    ["no origin from another site", { "sec-fetch-site": "cross-site" }],
  ])("refuses %s", async (_label, headers) => {
    const res = await pick(headers);
    expect(res.status).toBe(403);
    expect(workspaces.setPickedWorkspace).not.toHaveBeenCalled();
  });
});
