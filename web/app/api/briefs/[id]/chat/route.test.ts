import { beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const create = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create } };
  },
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "user_1" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createAdminSupabase: () => {
    const b: Record<string, unknown> = {};
    for (const op of ["select", "eq", "update", "is"]) b[op] = () => b;
    b.maybeSingle = async () => ({ data: { id: "b1", status: "drafted" }, error: null });
    return { from: () => b };
  },
}));

import { POST } from "./route";

async function* chunks(...parts: string[]) {
  for (const content of parts) yield { choices: [{ delta: { content } }] };
}

beforeEach(() => {
  create.mockReset();
  create.mockImplementation(async () => chunks("<note>Done.</note>"));
});

test("the ticket assistant streams from gpt-5.6-luna with reasoning off, keeping its temperature", async () => {
  const req = new NextRequest("http://localhost/api/briefs/b1/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Make it shorter" }], title: "Pay 500s", body: "It 500s." }),
  });
  const res = await POST(req, { params: Promise.resolve({ id: "b1" }) });
  expect(await res.text()).toBe("<note>Done.</note>");
  // temperature is only accepted by gpt-5.6 when reasoning is off.
  expect(create.mock.calls[0][0]).toMatchObject({ model: "gpt-5.6-luna", reasoning_effort: "none", temperature: 0.4, stream: true });
});
