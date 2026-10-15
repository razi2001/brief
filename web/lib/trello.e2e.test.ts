import { describe, expect, it } from "vitest";
import {
  listTrelloWorkspaces,
  makeTrelloTracker,
  trelloBatchPath,
  trelloSearchPath,
} from "@/lib/trello";

/**
 * Live round trip against a real Trello account. Skipped unless a personal key
 * and token are set, which authenticate exactly like the token Brief's own
 * authorization hands back:
 *
 *   LIVE_TRELLO_KEY, LIVE_TRELLO_TOKEN   (LIVE_TRELLO_TARGET picks a board id)
 *
 * It files a real card, so it always deletes it again, even when an assertion
 * fails halfway.
 */

const KEY = process.env.LIVE_TRELLO_KEY ?? "";
const TOKEN = process.env.LIVE_TRELLO_TOKEN ?? "";

// 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function authed(path: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `https://api.trello.com/1${path}${sep}key=${encodeURIComponent(KEY)}&token=${encodeURIComponent(TOKEN)}`;
}

/**
 * Straight to Trello, around the adapter, so the checks do not trust it. The
 * error names the path only, never the URL that carries the key and token.
 */
async function trello<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(authed(path), init);
  if (!r.ok) throw new Error(`Trello ${path.split("?")[0]} failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!KEY || !TOKEN)("Trello live round trip", () => {
  it(
    "files a card with a cover and a logs file, reads it back, moves it, and finds it live",
    async () => {
      const tok = { key: KEY, token: TOKEN };
      const tracker = makeTrelloTracker(tok);

      const workspaces = await listTrelloWorkspaces(tok);
      expect(Array.isArray(workspaces)).toBe(true);
      for (const w of workspaces) {
        expect(w.id).toBeTruthy();
        expect(w.name).toBeTruthy();
        // The logo is shown as an <img>, so it has to be an image that loads.
        if (w.avatarUrl) expect((await fetch(w.avatarUrl)).status).toBe(200);
      }

      const targets = await tracker.listTargets();
      expect(targets.length).toBeGreaterThan(0);
      const targetId = process.env.LIVE_TRELLO_TARGET || targets[0].id;
      const details = await tracker.getTargetDetails(targetId);
      expect(details.states.length).toBeGreaterThan(0);

      // A label and a member, when the board has them, prove the comma-joined
      // id format the create call sends is one Trello accepts.
      const label = details.labels[0];
      const member = details.members[0];

      // A word only this card contains, for the search check.
      const nonce = `brfe2e${Date.now().toString(36)}`;

      const created = await tracker.fileIssue({
        targetId,
        title: `Brief e2e ${new Date().toISOString()}`,
        descriptionMarkdown: `**What happened**\nAn automated check filed this card (${nonce}). It is deleted right away.`,
        state: details.states[0],
        ...(label ? { labels: [label] } : {}),
        ...(member ? { assignee: member } : {}),
        evidence: [
          { filename: "shot-e2e.png", contentType: "image/png", bytes: PNG, caption: "A single pixel" },
        ],
        details: [{ title: "Video 1 logs", markdown: "GET /api/health 200" }],
      });

      try {
        expect(created.identifier).toBeTruthy();
        expect(created.url).toMatch(/^https:\/\/trello\.com\/c\//);

        // The screenshot is the cover and the logs file is the last attachment,
        // under neutral names.
        const card = await trello<{ desc: string; idAttachmentCover: string | null }>(
          `/cards/${created.id}?fields=desc,idAttachmentCover`,
        );
        const attachments = await trello<Array<{ id: string; name: string; mimeType: string }>>(
          `/cards/${created.id}/attachments?fields=name,mimeType`,
        );
        expect(attachments.map((a) => a.name)).toEqual(["Screenshot 1", "Technical logs"]);
        expect(card.idAttachmentCover).toBe(attachments[0].id);
        expect(card.desc).toContain("- Screenshot 1: A single pixel");
        expect(card.desc).not.toMatch(/technical/i);

        const read = await tracker.getIssue(created.identifier);
        expect(read.title).toBe(created.title);
        expect(read.state).toBe(details.states[0]);
        if (label) expect(read.labels).toContain(label);
        if (member) expect(read.assignee).toBe(member);

        // Move it to another list when the board has one.
        const nextState = details.states[1] ?? details.states[0];
        const updated = await tracker.updateIssue(created.identifier, { state: nextState });
        expect(updated).toEqual({ ok: true });
        expect((await tracker.getIssue(created.identifier)).state).toBe(nextState);

        // searchIssues and getLiveIssues swallow every failure, so a request
        // Trello rejects would look like an empty answer. Replay the adapter's
        // exact requests raw first: these throw on anything but a 2xx.
        const batch = await trello<unknown[]>(trelloBatchPath([created.identifier]));
        expect(batch).toHaveLength(1);
        expect(batch[0]).toHaveProperty("200");
        await trello(trelloSearchPath(nonce, 15));

        const live = await tracker.getLiveIssues([created.identifier]);
        expect(live.issues[created.identifier]).toBeDefined();
        expect(live.issues[created.identifier].stateName).toBe(nextState);
        expect(live.gone).toEqual([]);

        // Trello indexes a new card for search after a short delay.
        let found = false;
        for (let attempt = 0; attempt < 15 && !found; attempt++) {
          const hits = await tracker.searchIssues(nonce);
          found = hits.some((h) => h.identifier === created.identifier);
          if (!found) await sleep(2000);
        }
        expect(found).toBe(true);
      } finally {
        const r = await fetch(authed(`/cards/${created.id}`), { method: "DELETE" });
        if (!r.ok) {
          console.warn(
            `[trello-e2e] could not delete card ${created.identifier} (${r.status}); delete it by hand: ${created.url}`,
          );
        }
      }
    },
    120_000,
  );
});
