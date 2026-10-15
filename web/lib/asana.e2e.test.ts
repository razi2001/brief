import { describe, expect, it } from "vitest";
import { listAsanaWorkspaces, makeAsanaTracker } from "@/lib/asana";

/**
 * Files a real task into a real Asana workspace, reads it back, moves it,
 * live-reads it and deletes it. Skipped unless LIVE_ASANA_TOKEN (a personal
 * access token, sent as a Bearer token exactly like an OAuth one) is set.
 *
 * It is the only check of what the unit tests cannot prove: that Asana's
 * rich-text validator accepts what asana-html.ts writes, that an inline image
 * referencing a fresh attachment by `data-asana-gid` sticks, that the
 * create-then-move section path and the other extras land, and that a task in
 * the trash answers 404 inside a batch (so it reads as gone).
 *
 * Optional: LIVE_ASANA_WORKSPACE (gid), LIVE_ASANA_TARGET (project gid).
 */

const API = "https://app.asana.com/api/1.0";
const token = process.env.LIVE_ASANA_TOKEN ?? "";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function raw<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`Asana ${path.split("?")[0]} failed: ${r.status}`);
  return ((await r.json()) as { data: T }).data;
}

describe.skipIf(!process.env.LIVE_ASANA_TOKEN)("Asana live", () => {
  it(
    "files, reads back, moves, live-reads and deletes a task",
    async () => {
      const workspaces = await listAsanaWorkspaces(token);
      expect(workspaces.length).toBeGreaterThan(0);
      const workspaceGid = process.env.LIVE_ASANA_WORKSPACE || workspaces[0].id;

      const tracker = makeAsanaTracker({ token, workspaceGid });
      const targets = await tracker.listTargets();
      const targetId = process.env.LIVE_ASANA_TARGET || targets[0]?.id;
      expect(targetId, "no project in this workspace").toBeTruthy();

      // File straight into the LAST section (not the default first one), so the
      // create-then-move path is what puts it there.
      const details = await tracker.getTargetDetails(targetId);
      const fileState = details.states.length > 1 ? details.states[details.states.length - 1] : undefined;
      const label = details.labels[0];

      const title = `Brief e2e ${new Date().toISOString()}`;
      const filed = await tracker.fileIssue({
        targetId,
        title,
        state: fileState,
        labels: label ? [label] : undefined,
        assignee: "me",
        comment: "Live check comment.",
        // Every construct the converter emits, so Asana's validator sees them all.
        descriptionMarkdown: [
          "A live check of the Asana adapter. Safe to delete.",
          "",
          "**Steps to reproduce**",
          "1. Open [the app](https://cloud.get-brief.app/)",
          "   - nested item",
          "2. Click **Save** with *feeling* and `code`",
          "",
          "### Expected",
          "> quoted & <escaped>",
          "",
          "| a | b |",
          "|---|---|",
          "| 1 | 2 |",
          "",
          "```",
          "const x = 1 < 2;",
          "```",
        ].join("\n"),
        evidence: [{ filename: "pixel.png", contentType: "image/png", bytes: PNG, caption: "A single test pixel" }],
        details: [{ title: "Video 1", markdown: "GET https://example.com/api 200" }],
      });

      let deleted = false;
      try {
        expect(filed.identifier).toMatch(/^\d+$/);
        expect(filed.url).toContain("asana.com");

        const got = await tracker.getIssue(filed.identifier);
        expect(got.title).toBe(title);
        // Every extra landed: the section move, the assignee, the tag.
        if (fileState) expect(got.section).toBe(fileState);
        expect(got.assignee).toBeTruthy();
        if (label) expect(got.tags).toContain(label);

        const stories = await raw<Array<{ text?: string; resource_subtype?: string }>>(
          `/tasks/${filed.identifier}/stories?opt_fields=text,resource_subtype`,
        );
        expect(stories.some((s) => s.text === "Live check comment.")).toBe(true);

        // The rich text was accepted (not the plain-text fallback) and the
        // image rewrite landed.
        const notes = await raw<{ html_notes?: string }>(`/tasks/${filed.identifier}?opt_fields=html_notes`);
        expect(notes.html_notes).toContain("<h2>");
        expect(notes.html_notes).toMatch(/<img\b/);

        const attachments = await raw<Array<{ name?: string }>>(
          `/attachments?parent=${filed.identifier}&opt_fields=name`,
        );
        expect(attachments.map((a) => a.name)).toEqual(
          expect.arrayContaining(["screenshot-1.png", "technical-logs.md"]),
        );

        // Move it to the first section (or complete it, in a project with one).
        const state = details.states.length > 1 ? details.states[0] : "Done";
        expect(await tracker.updateIssue(filed.identifier, { state })).toEqual({ ok: true });
        const moved = await tracker.getIssue(filed.identifier);
        if (state === "Done") expect(moved.completed).toBe(true);
        else expect(moved.section).toBe(state);

        const live = await tracker.getLiveIssues([filed.identifier]);
        expect(live.issues[filed.identifier]).toBeDefined();
        expect(live.gone).toEqual([]);

        // A deleted task sits in the trash, and must read as gone: the 404 is
        // trusted because this token still belongs to the workspace.
        const del = await fetch(`${API}/tasks/${filed.identifier}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(del.ok).toBe(true);
        deleted = true;
        const after = await tracker.getLiveIssues([filed.identifier]);
        expect(after.gone).toEqual([filed.identifier]);
        expect(after.issues[filed.identifier]).toBeUndefined();
      } finally {
        if (!deleted) {
          await fetch(`${API}/tasks/${filed.identifier}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
    },
    120_000,
  );
});
