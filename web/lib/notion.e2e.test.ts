import { describe, expect, it } from "vitest";
import { listNotionWorkspaces, makeNotionTracker } from "@/lib/notion";

/**
 * Live round trip against a real Notion workspace. Skipped unless
 * LIVE_NOTION_TOKEN is set (an internal integration secret, or an OAuth token,
 * shared with at least one database). LIVE_NOTION_TARGET picks the database;
 * otherwise the first one the token can see is used.
 *
 * It files a real page, so it always archives it again, even when an
 * assertion fails half way.
 */

const TOKEN = process.env.LIVE_NOTION_TOKEN;

// 1x1 transparent PNG. Its bytes are uploaded into Notion, well under even a
// free workspace's 5 MiB limit, so the page shows Notion's own copy; the url
// is only the fallback had the upload failed.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PIXEL_URL = "https://upload.wikimedia.org/wikipedia/commons/c/ca/1x1.png";

async function notion(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
  });
}

describe.skipIf(!TOKEN)("Notion live", () => {
  it(
    "files a page with evidence and logs, reads it back, moves it, and syncs it",
    async () => {
      const tok = { token: TOKEN! };

      const workspaces = await listNotionWorkspaces(tok);
      expect(workspaces).toHaveLength(1);
      // The id is the org key, so it has to be Notion's real workspace UUID.
      expect(workspaces[0].id).toMatch(
        /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i,
      );

      const tracker = makeNotionTracker(tok);
      const targets = await tracker.listTargets();
      expect(targets.length).toBeGreaterThan(0);
      const wanted = process.env.LIVE_NOTION_TARGET;
      const target = wanted
        ? (targets.find((t) => t.id.replace(/-/g, "") === wanted.replace(/-/g, "")) ?? { id: wanted })
        : targets[0];

      const details = await tracker.getTargetDetails(target.id);

      const title = `Brief e2e ${new Date().toISOString()}`;
      const filed = await tracker.fileIssue({
        targetId: target.id,
        title,
        descriptionMarkdown:
          "The save button does nothing on checkout.\n\n**Steps to reproduce**\n\n1. Open the cart\n2. Press Save",
        evidence: [
          {
            filename: "pixel.png",
            contentType: "image/png",
            bytes: PIXEL,
            caption: "A single pixel",
            url: PIXEL_URL,
          },
        ],
        details: [
          {
            title: "Technical logs: Screen recording",
            markdown: "**Timeline** (1 call; in order)\n\n```text\n0:01  GET  api/cart  500  12 ms\n```",
          },
        ],
      });

      try {
        expect(filed.identifier).toBeTruthy();
        expect(filed.url).toMatch(/^https:\/\/www\.notion\.so\//);

        const got = await tracker.getIssue(filed.identifier);
        expect(got.title).toBe(title);

        // The body landed as real blocks: the image uploaded, the logs folded.
        // An attached upload reads back as a Notion-hosted "file", not by url.
        const kids = (await (await notion(`/blocks/${filed.identifier}/children?page_size=100`)).json()) as {
          results?: Array<{
            type: string;
            image?: { type?: string; file?: { url?: string }; external?: { url?: string } };
          }>;
        };
        const blocks = kids.results ?? [];
        const image = blocks.find((b) => b.type === "image");
        expect(image?.image?.type).toBe("file");
        expect(image?.image?.file?.url).toBeTruthy();
        expect(image?.image?.external).toBeUndefined();
        expect(blocks.some((b) => b.type === "toggle")).toBe(true);

        if (details.states.length) {
          const state = details.states[details.states.length - 1];
          expect(await tracker.updateIssue(filed.identifier, { state })).toEqual({ ok: true });
          expect((await tracker.getIssue(filed.identifier)).state).toBe(state);
        }

        const live = await tracker.getLiveIssues([filed.identifier]);
        expect(live.issues[filed.identifier]).toBeDefined();
        expect(live.issues[filed.identifier].title).toBe(title);
        expect(live.gone).toEqual([]);
      } finally {
        await notion(`/pages/${filed.identifier}`, {
          method: "PATCH",
          body: JSON.stringify({ archived: true }),
        });
      }
    },
    120_000,
  );
});
