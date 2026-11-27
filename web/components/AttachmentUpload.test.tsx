// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import AttachmentUpload from "./AttachmentUpload";

type Call = { url: string; method: string; body: unknown; headers?: Record<string, string> };

function stubFetch(opts: { failPut?: boolean } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
      calls.push({ url, method: init.method ?? "GET", body, headers: init.headers as Record<string, string> });
      if (url.endsWith("/attachments") && init.method === "POST") {
        const paths = (body as { paths: string[] }).paths;
        return Response.json({ uploads: Object.fromEntries(paths.map((p) => [p, `https://store.test/${p}`])) });
      }
      if (url.startsWith("https://store.test/")) return new Response(null, { status: opts.failPut ? 500 : 200 });
      return Response.json({ ok: true });
    }),
  );
  return calls;
}

const pick = (files: File[]) => fireEvent.change(screen.getByTestId("attachment-input"), { target: { files } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe("AttachmentUpload", () => {
  it("uploads a PNG as a screenshot and a video as the recording, then refreshes", async () => {
    const calls = stubFetch();
    render(<AttachmentUpload briefId="b1" />);
    pick([new File(["png"], "a.png", { type: "image/png" }), new File(["vid"], "clip.mp4", { type: "video/mp4" })]);
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    const sign = calls.find((c) => c.method === "POST")!;
    const paths = (sign.body as { paths: string[] }).paths;
    expect(paths[0]).toMatch(/^screenshots\/upload-\d+-1\.png$/);
    expect(paths[1]).toBe("recording.mp4");

    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts.map((p) => p.url).sort()).toEqual(paths.map((p) => `https://store.test/${p}`).sort());
    expect(puts.find((p) => p.url.endsWith("recording.mp4"))?.headers?.["Content-Type"]).toBe("video/mp4");

    const done = calls.find((c) => c.method === "PATCH");
    expect(done?.body).toEqual({ recording: "recording.mp4" });
  });

  it("images only: no recording step", async () => {
    const calls = stubFetch();
    render(<AttachmentUpload briefId="b1" />);
    pick([new File(["png"], "a.png", { type: "image/png" })]);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("refuses a video over 50 MB before uploading anything", async () => {
    const calls = stubFetch();
    render(<AttachmentUpload briefId="b1" />);
    const big = new File(["x"], "big.mp4", { type: "video/mp4" });
    Object.defineProperty(big, "size", { value: 51 * 1024 * 1024 });
    pick([big]);
    expect(await screen.findByText("Video over 50 MB")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("says so when an upload fails, and doesn't refresh", async () => {
    stubFetch({ failPut: true });
    render(<AttachmentUpload briefId="b1" />);
    pick([new File(["png"], "a.png", { type: "image/png" })]);
    expect(await screen.findByText("Upload failed")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button").textContent).toContain("Add files");
  });

  it("ignores files that are neither images nor videos", async () => {
    const calls = stubFetch();
    render(<AttachmentUpload briefId="b1" />);
    pick([new File(["%PDF"], "a.pdf", { type: "application/pdf" })]);
    expect(await screen.findByText("Images or videos only")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});
