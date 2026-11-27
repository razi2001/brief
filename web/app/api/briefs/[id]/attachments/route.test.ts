import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  userId: "u1" as string | null,
  brief: null as Record<string, unknown> | null,
  files: new Map<string, string>(),
  removed: [] as string[],
  signed: [] as string[],
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: state.userId }) }));
vi.mock("@/lib/supabase/server", () => ({
  createAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.brief }) }) }),
      }),
    }),
    storage: {
      from: () => ({
        createSignedUploadUrl: async (p: string) => {
          state.signed.push(p);
          return { data: { signedUrl: `https://store.test/${p}` } };
        },
        remove: async (ps: string[]) => {
          state.removed.push(...ps);
          for (const p of ps) state.files.delete(p);
          return { error: null };
        },
        download: async (p: string) => ({ data: state.files.has(p) ? new Blob([state.files.get(p)!]) : null }),
        upload: async (p: string, body: string) => {
          state.files.set(p, body);
          return { error: null };
        },
      }),
    },
  }),
}));

import { PATCH, POST } from "./route";

const ctx = { params: Promise.resolve({ id: "b1" }) };
const req = (body: unknown) => new Request("https://app.test/x", { method: "POST", body: JSON.stringify(body) }) as never;
const draft = { id: "b1", status: "drafted", storage_prefix: "u1/b1", ticket_url: null, ticket_body: null, filing_started_at: null };

beforeEach(() => {
  state.userId = "u1";
  state.brief = { ...draft };
  state.files = new Map();
  state.removed = [];
  state.signed = [];
});

describe("POST /api/briefs/[id]/attachments", () => {
  it("signs uploads for screenshots and a recording in the draft's folder", async () => {
    const res = await POST(req({ paths: ["screenshots/upload-1-1.png", "recording.mp4"] }), ctx);
    expect(res.status).toBe(200);
    expect(state.signed).toEqual(["u1/b1/screenshots/upload-1-1.png", "u1/b1/recording.mp4"]);
    expect(Object.keys((await res.json()).uploads)).toEqual(["screenshots/upload-1-1.png", "recording.mp4"]);
  });

  it("refuses any other path", async () => {
    for (const p of ["brief.json", "screenshots/../../x.png", "screenshots/a.png", "recording.avi"]) {
      expect((await POST(req({ paths: [p] }), ctx)).status).toBe(400);
    }
  });

  it("refuses a stranger, and a brief that isn't a draft", async () => {
    state.userId = null;
    expect((await POST(req({ paths: ["recording.mp4"] }), ctx)).status).toBe(401);
    state.userId = "u1";
    state.brief = null; // someone else's brief: the owner-scoped query finds nothing
    expect((await POST(req({ paths: ["recording.mp4"] }), ctx)).status).toBe(404);
    state.brief = { ...draft, status: "filed", ticket_url: "https://t" };
    expect((await POST(req({ paths: ["recording.mp4"] }), ctx)).status).toBe(409);
  });
});

describe("PATCH /api/briefs/[id]/attachments", () => {
  it("makes the video the recording and marks it attached, on a blank draft", async () => {
    const res = await PATCH(req({ recording: "recording.mp4" }), ctx);
    expect(res.status).toBe(200);
    expect(state.removed).toEqual(["u1/b1/recording.webm", "u1/b1/recording.mov"]);
    expect(JSON.parse(state.files.get("u1/b1/brief.json")!)).toEqual({
      recording: { file: "recording.mp4", source: "upload" },
      hasRecording: true,
      includeVideo: true,
    });
  });

  it("keeps a captured draft's brief.json, and its page", async () => {
    state.files.set("u1/b1/brief.json", JSON.stringify({ pageUrl: "https://acme.com", includeVideo: false }));
    await PATCH(req({ recording: "recording.webm" }), ctx);
    expect(JSON.parse(state.files.get("u1/b1/brief.json")!)).toEqual({
      pageUrl: "https://acme.com",
      recording: { file: "recording.webm" },
      hasRecording: true,
      includeVideo: true,
    });
  });

  it("refuses a name that isn't a recording", async () => {
    expect((await PATCH(req({ recording: "brief.json" }), ctx)).status).toBe(400);
  });
});
