import { describe, expect, it } from "vitest";
import { listGitlabGroups, makeGitlabTracker, parseGitlabRef, type GitlabTok } from "@/lib/gitlab";

/**
 * Files a real issue on gitlab.com and cleans it up. Skipped unless
 * LIVE_GITLAB_TOKEN (a personal access token with the `api` scope) is set;
 * LIVE_GITLAB_TARGET picks the project by id, else the first listed one.
 */
const TOKEN = process.env.LIVE_GITLAB_TOKEN;

// A 1x1 PNG, the smallest real image GitLab will accept as an upload.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe.skipIf(!TOKEN)("GitLab live", () => {
  it(
    "files, reads back, closes, live-reads and removes an issue",
    async () => {
      const tok: GitlabTok = { token: TOKEN! };
      const api = "https://gitlab.com/api/v4";
      const tracker = makeGitlabTracker(tok);

      const groups = await listGitlabGroups(tok);
      expect(Array.isArray(groups)).toBe(true);

      const targets = await tracker.listTargets();
      expect(targets.length).toBeGreaterThan(0);
      const target = process.env.LIVE_GITLAB_TARGET
        ? targets.find((t) => t.id === process.env.LIVE_GITLAB_TARGET) ?? { id: process.env.LIVE_GITLAB_TARGET }
        : targets[0];

      const details = await tracker.getTargetDetails(target.id);
      expect(details.states).toContain("Closed");

      const filed = await tracker.fileIssue({
        targetId: target.id,
        title: `Brief e2e ${new Date().toISOString()}`,
        descriptionMarkdown: "Automated end-to-end check.\n\n**Steps to reproduce**\n\n1. Run the live test",
        evidence: [{ filename: "e2e.png", contentType: "image/png", bytes: PNG, caption: "A single pixel" }],
        details: [{ title: "Network calls", markdown: "| GET /e2e | 200 |" }],
      });
      const ref = parseGitlabRef(filed.identifier);
      expect(ref).not.toBeNull();

      try {
        const read = await tracker.getIssue(filed.identifier);
        expect(read.title).toBe(filed.title);
        expect(read.state).toBe("Open");

        expect(await tracker.updateIssue(filed.identifier, { state: "Closed" })).toEqual({ ok: true });

        const live = await tracker.getLiveIssues([filed.identifier]);
        expect(live.issues[filed.identifier]?.stateName).toBe("Closed");
        expect(live.gone).toEqual([]);
      } finally {
        // Deleting needs Owner; anyone less gets a 403, and the issue is
        // closed instead so the project is not left with an open test ticket.
        const path = `${api}/projects/${encodeURIComponent(ref!.path)}/issues/${ref!.iid}`;
        const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
        const del = await fetch(path, { method: "DELETE", headers });
        if (del.status === 403) {
          await fetch(path, { method: "PUT", headers, body: JSON.stringify({ state_event: "close" }) });
        }
      }
    },
    120_000,
  );
});
