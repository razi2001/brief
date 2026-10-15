import { describe, expect, it } from "vitest";
import { clickupAuthHeader, listClickUpWorkspaces, makeClickUpTracker } from "@/lib/clickup";
import type { Tracker } from "@/lib/tracker";

/**
 * Against the real ClickUp API. Skipped unless LIVE_CLICKUP_TOKEN is set (a
 * personal `pk_...` token works). LIVE_CLICKUP_TARGET picks the list to file
 * into, in whichever workspace holds it; otherwise the first list of the first
 * workspace is used. The task is deleted inside the run (to check that a
 * deletion reads as `gone`) and again in `finally` as a backstop, so a failed
 * run leaves nothing behind.
 */
const TOKEN = process.env.LIVE_CLICKUP_TOKEN;
const TARGET = process.env.LIVE_CLICKUP_TARGET;
const API = "https://api.clickup.com/api/v2";

// A 1x1 PNG, the smallest real image ClickUp will accept as an attachment.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** The tracker scoped to the workspace that holds the target, and the target. */
async function pickTarget(token: string): Promise<{ tracker: Tracker; targetId: string }> {
  const workspaces = await listClickUpWorkspaces(token);
  expect(workspaces.length, "the token sees no ClickUp workspace").toBeGreaterThan(0);
  for (const w of TARGET ? workspaces : workspaces.slice(0, 1)) {
    const tracker = makeClickUpTracker({ token, teamId: w.id });
    const lists = await tracker.listTargets();
    const hit = TARGET ? lists.find((l) => l.id === TARGET) : lists[0];
    if (hit) return { tracker, targetId: hit.id };
  }
  throw new Error(
    TARGET
      ? `LIVE_CLICKUP_TARGET ${TARGET} is not a list in any workspace this token sees`
      : "the first ClickUp workspace has no list to file into",
  );
}

describe.skipIf(!TOKEN)("ClickUp live", () => {
  it(
    "files a task with evidence and logs, reads it back, updates it, and sees it go",
    async () => {
      const token = TOKEN!;
      const auth = { Authorization: clickupAuthHeader(token) };
      const { tracker, targetId } = await pickTarget(token);

      const title = `Brief e2e ${new Date().toISOString()}`;
      const filed = await tracker.fileIssue({
        targetId,
        title,
        descriptionMarkdown: "**Summary**\n\nAn automated test task. Safe to delete.",
        evidence: [
          { filename: "frame-01.png", contentType: "image/png", bytes: PIXEL, caption: "A single test pixel" },
        ],
        details: [{ title: "Technical logs: Video 1", markdown: "```text\nGET /api/health 200\n```" }],
      });

      try {
        expect(filed.identifier).toBeTruthy();
        expect(filed.url).toMatch(/^https:\/\/app\.clickup\.com\//);

        const got = await tracker.getIssue(filed.identifier);
        expect(got.title).toBe(title);

        // The body as ClickUp stored it: the screenshot embedded from ClickUp's
        // own attachment host, one Evidence section, the logs, then the
        // attribution last.
        const raw = (await (
          await fetch(`${API}/task/${filed.id}?include_markdown_description=true`, { headers: auth })
        ).json()) as { markdown_description?: string };
        const md = raw.markdown_description ?? "";
        expect(md).toMatch(/!\[Screenshot 1\]\([^)]*clickup-attachments\.com/);
        expect((md.match(/^#{1,6}\s*evidence\s*$/gim) ?? []).length).toBe(1);
        expect(md).toContain("Technical logs: Video 1");
        expect(md).toContain("GET /api/health 200");
        expect(md).toContain("Reported with");
        expect(md.indexOf("Technical logs")).toBeLessThan(md.lastIndexOf("Reported with"));
        expect(md).not.toContain("frame-01");

        const detail = await tracker.getTargetDetails(targetId);
        const current = String(got.state ?? "").toLowerCase();
        const next = detail.states.find((s) => s.toLowerCase() !== current) ?? detail.states[0];
        expect(next, "the list has no statuses").toBeTruthy();
        expect(await tracker.updateIssue(filed.identifier, { state: next })).toEqual({ ok: true });

        const live = await tracker.getLiveIssues([filed.identifier]);
        expect(live.issues[filed.identifier]).toBeDefined();
        expect(live.issues[filed.identifier].stateName.toLowerCase()).toBe(next.toLowerCase());
        expect(live.gone).toEqual([]);

        // A task deleted in ClickUp must read as gone, and only as gone.
        const del = await fetch(`${API}/task/${filed.id}`, { method: "DELETE", headers: auth });
        expect(del.ok, `DELETE answered ${del.status}`).toBe(true);
        const after = await tracker.getLiveIssues([filed.identifier]);
        expect(after.gone).toEqual([filed.identifier]);
        expect(after.issues[filed.identifier]).toBeUndefined();
      } finally {
        // Backstop for a run that failed before the delete above. A 404 here
        // just means the task is already gone.
        await fetch(`${API}/task/${filed.id}`, { method: "DELETE", headers: auth }).catch(() => undefined);
      }
    },
    120_000,
  );
});
