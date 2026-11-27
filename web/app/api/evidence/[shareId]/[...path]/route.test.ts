import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const raw = readFileSync(join(__dirname, "../../../../../lib/__fixtures__/mediarecorder.webm"));

vi.mock("@/lib/supabase/server", () => ({
  createAdminSupabase: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { storage_prefix: "u/b" } }) }) }) }),
    storage: { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array(raw)]) }) }) },
  }),
}));

import { GET } from "./route";

const call = (range?: string) =>
  GET(new Request("https://app.test/api/evidence/s/recording.webm", { headers: range ? { range } : {} }) as never, {
    params: Promise.resolve({ shareId: "s", path: ["recording.webm"] }),
  });

describe("evidence route: recordings", () => {
  it("serves the WebM with its duration written in, and says it takes ranges", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBeGreaterThan(raw.length);
    expect(body.indexOf(Buffer.from([0x44, 0x89, 0x88]))).toBeGreaterThan(0);
  });

  it("answers a Range request with 206 and the right slice", async () => {
    const full = Buffer.from(await (await call()).arrayBuffer());
    const res = await call("bytes=100-199");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 100-199/${full.length}`);
    expect(Buffer.from(await res.arrayBuffer()).equals(full.subarray(100, 200))).toBe(true);
    expect((await call(`bytes=${full.length}-`)).status).toBe(416);
  });
});
