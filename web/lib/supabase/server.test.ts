import { describe, expect, it } from "vitest";
import v8 from "node:v8";
import vm from "node:vm";
import { createAdminSupabase } from "./server";

v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc") as () => void;

function heapMb(): number {
  gc();
  gc();
  return process.memoryUsage().heapUsed / 1e6;
}

describe("createAdminSupabase", () => {
  // The server makes a client per call (97 call sites, the feed polls every
  // 30s). With the auth refresh timer on, each one stayed on the heap for good
  // (~12 KB), and prod ran out of memory after ~20h.
  it("lets its clients be garbage-collected", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY ||= "service-role-key";
    for (let i = 0; i < 200; i++) createAdminSupabase(); // warm up module caches
    const before = heapMb();
    for (let i = 0; i < 3000; i++) createAdminSupabase();
    await new Promise((r) => setTimeout(r, 50));
    // leaking, 3000 clients hold ~36 MB; freed, the heap barely moves
    expect(heapMb() - before).toBeLessThan(8);
  });
});
