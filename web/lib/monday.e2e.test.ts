import { describe, expect, it } from "vitest";
import { listMondayAccount, makeMondayTracker } from "@/lib/monday";

/**
 * Live round trip against a real monday.com account. Skipped unless
 * LIVE_MONDAY_TOKEN holds a personal API token (it behaves exactly like the
 * OAuth token Brief stores). LIVE_MONDAY_TARGET picks a board; otherwise the
 * most recently used one is used. The item is deleted at the end either way.
 *
 *   node --env-file=.env.local node_modules/vitest/vitest.mjs run lib/monday.e2e.test.ts
 */

const TOKEN = process.env.LIVE_MONDAY_TOKEN;

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Straight to the API, for what the adapter has no method for (reading assets, deleting). */
async function raw<T>(query: string): Promise<T> {
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { Authorization: TOKEN!, "API-Version": "2026-07", "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const j = (await r.json()) as { data?: T; errors?: Array<{ message?: string }> };
  if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join("; "));
  return j.data as T;
}

describe.skipIf(!TOKEN)("Monday live", () => {
  it(
    "files an item with evidence and logs, reads it, updates it, live-reads it, then deletes it",
    async () => {
      const tok = { token: TOKEN! };

      const accounts = await listMondayAccount(tok);
      expect(accounts).toHaveLength(1);

      const tracker = makeMondayTracker(tok);
      const targets = await tracker.listTargets();
      expect(targets.length).toBeGreaterThan(0);
      const targetId = process.env.LIVE_MONDAY_TARGET || targets[0].id;
      const details = await tracker.getTargetDetails(targetId);

      const title = `Brief e2e ${new Date().toISOString()}`;
      const filed = await tracker.fileIssue({
        targetId,
        title,
        descriptionMarkdown: "**Steps to reproduce**\n\n1. Open the page\n2. Click Save\n\nNothing is saved.",
        evidence: [
          {
            filename: "keyframe-0.png",
            contentType: "image/png",
            bytes: PNG_1X1,
            caption: "The page after clicking Save",
          },
        ],
        details: [{ title: "Network", markdown: "| Method | URL | Status |\n|---|---|---|\n| POST | /api/save | 500 |" }],
      });

      try {
        expect(filed.identifier).toMatch(/^\d+$/);
        expect(filed.url).toContain(filed.identifier);

        const got = await tracker.getIssue(filed.identifier);
        expect(got.title).toBe(title);

        // The description is the first update, with the screenshot and the
        // logs attached to it under their neutral names.
        const posted = await raw<{
          items: Array<{ updates: Array<{ body: string; assets: Array<{ name: string }> }> }>;
        }>(`query { items(ids: [${filed.identifier}]) { updates(limit: 5) { body assets { name } } } }`);
        const first = posted.items[0].updates.at(-1)!;
        expect(first.body).toContain("Steps to reproduce");
        expect(first.body).toContain("The page after clicking Save");
        expect(first.body).toContain("Brief");
        expect(first.assets.map((a) => a.name).sort()).toEqual(["screenshot-1.png", "technical-logs.md"]);

        if (details.states.length) {
          const state = details.states[details.states.length - 1];
          const r = await tracker.updateIssue(filed.identifier, { state });
          expect(r).toEqual({ ok: true });
          expect((await tracker.getIssue(filed.identifier)).state).toBe(state);
        }

        // Search runs over the most recently used boards. A fresh tracker
        // reads that order again, now that the board was just filed into.
        const found = await makeMondayTracker(tok).searchIssues(title);
        expect(found.map((f) => f.identifier)).toContain(filed.identifier);

        const live = await tracker.getLiveIssues([filed.identifier]);
        expect(live.issues[filed.identifier]).toBeDefined();
        expect(live.issues[filed.identifier].title).toBe(title);
        expect(live.gone).toEqual([]);

        // A deleted item must read back as gone, which is what clears it from
        // the tickets feed.
        await raw(`mutation { delete_item(item_id: ${filed.identifier}) { id } }`);
        const after = await tracker.getLiveIssues([filed.identifier]);
        expect(after.gone).toEqual([filed.identifier]);
        expect(after.issues[filed.identifier]).toBeUndefined();
      } finally {
        // Backstop for a failure above; after the delete in the try this
        // errors (already deleted), which is fine.
        await raw(`mutation { delete_item(item_id: ${filed.identifier}) { id } }`).catch(() => undefined);
      }
    },
    120_000,
  );
});
