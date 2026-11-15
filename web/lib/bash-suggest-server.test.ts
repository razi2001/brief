import { beforeEach, describe, expect, it, vi } from "vitest";

const suggestAreas = vi.fn();
vi.mock("@/lib/bash-ai", () => ({ suggestAreas: (...a: unknown[]) => suggestAreas(...a) }));

// Six filed tickets for anyone, no org.
const tickets = Array.from({ length: 6 }, (_, i) => ({ title: `Checkout bug ${i}`, ticket_title: null, ticket_state_name: "Todo" }));
function chain(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "gte", "order", "limit"]) q[m] = () => q;
  q.maybeSingle = async () => ({ data: null });
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
  return q;
}
vi.mock("@/lib/supabase/server", () => ({
  createAdminSupabase: () => ({ from: () => chain({ data: tickets, error: null }) }),
}));

const area = (name: string) => [{ name, bugs: 6, open: 6 }];

describe("bash suggestions cache", () => {
  beforeEach(() => {
    vi.resetModules();
    suggestAreas.mockReset();
    vi.useRealTimers();
  });

  it("has nothing to peek at first, and starts working one out", async () => {
    suggestAreas.mockResolvedValue(area("Checkout"));
    const { peekSuggestions, suggestBashes } = await import("./bash-suggest-server");
    expect(peekSuggestions("u1")).toBeNull();
    expect(await suggestBashes("u1")).toEqual(area("Checkout"));
    expect(peekSuggestions("u1")).toEqual(area("Checkout"));
    expect(suggestAreas).toHaveBeenCalledTimes(1);
  });

  it("gives the old answer once it is old, and works out a new one behind it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    suggestAreas.mockResolvedValueOnce(area("Checkout")).mockResolvedValueOnce(area("Sign-in"));
    const { suggestBashes } = await import("./bash-suggest-server");
    await suggestBashes("u1");
    vi.setSystemTime(Date.now() + 7 * 60 * 60 * 1000);
    expect(await suggestBashes("u1")).toEqual(area("Checkout"));
    await vi.waitFor(() => expect(suggestAreas).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect(await suggestBashes("u1")).toEqual(area("Sign-in")));
  });
});
