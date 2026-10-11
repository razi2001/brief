import { beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const create = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({
  default: class {
    responses = { create };
  },
}));
// after() needs a live request scope; the safety-net write it schedules isn't under test.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "user_1" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createAdminSupabase: () => {
    const b: Record<string, unknown> = {};
    for (const op of ["select", "eq", "update", "is"]) b[op] = () => b;
    // A capture still being written up: nothing filed, no body, no filing claim.
    b.maybeSingle = async () => ({
      data: { id: "b1", status: "processing", storage_prefix: "user_1/b1", ticket_body: null, ticket_url: null, filing_started_at: null, share_id: null },
      error: null,
    });
    return { from: () => b };
  },
}));
vi.mock("@/lib/agent/run-processing", () => ({
  loadBriefInput: async () => ({
    input: { json: { description: "The pay button returns a 500" }, images: [], evidence: { files: [], items: [], includeVideo: false, fallback: [] } },
  }),
  draftBriefById: async () => {},
}));
vi.mock("@/lib/settings", () => ({ getUserSettings: async () => ({ ticketGuidance: "", role: "" }) }));

import { POST } from "./route";

async function* events(...parts: string[]) {
  yield { type: "response.created" };
  for (const delta of parts) yield { type: "response.output_text.delta", delta };
  yield { type: "response.completed" };
}

beforeEach(() => {
  create.mockReset();
  create.mockImplementation(async () => events("# Pay button 500s\n", "It 500s."));
});

test("the live draft streams from gpt-5.6-luna on the Responses API, reasoning on", async () => {
  const req = new NextRequest("http://localhost/api/briefs/b1/stream", { method: "POST" });
  const res = await POST(req, { params: Promise.resolve({ id: "b1" }) });
  expect(await res.text()).toBe("# Pay button 500s\nIt 500s.");
  expect(create.mock.calls[0][0]).toMatchObject({ model: "gpt-5.6-luna", stream: true, store: false, reasoning: { effort: "low" } });
});
