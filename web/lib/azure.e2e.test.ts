import { describe, expect, it } from "vitest";
import { bodyField, listAzureOrgs, makeAzureTracker } from "@/lib/azure";
import type { IssueResult } from "@/lib/tracker";

/**
 * Live round trip against a real Azure DevOps organization. Skipped unless
 * LIVE_AZURE_PAT and LIVE_AZURE_ORG are set (LIVE_AZURE_TARGET optionally
 * names the project). Run from web/ with:
 *
 *   node --env-file=<path to .env.local> node_modules/vitest/vitest.mjs run lib/azure.e2e.test.ts
 *
 * The work item it files is deleted at the end (to the recycle bin), whatever
 * happens in between.
 */

const PAT = process.env.LIVE_AZURE_PAT;
const ORG = process.env.LIVE_AZURE_ORG;

// 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe.skipIf(!PAT || !ORG)("Azure DevOps live", () => {
  it(
    "files, reads, updates, live-reads and deletes a work item",
    async () => {
      const org = ORG!;
      // A PAT is only accepted as HTTP Basic with an empty user name.
      const authorization = `Basic ${Buffer.from(":" + PAT).toString("base64")}`;

      // A PAT scoped to one organization may not list accounts; all that is
      // guaranteed is that the call degrades to a list rather than throwing.
      const orgs = await listAzureOrgs(authorization);
      expect(Array.isArray(orgs)).toBe(true);

      const tracker = makeAzureTracker({ org, authorization });
      const targets = await tracker.listTargets();
      expect(targets.length).toBeGreaterThan(0);
      const wanted = process.env.LIVE_AZURE_TARGET;
      const target = wanted ? targets.find((t) => t.id === wanted || t.name === wanted) : targets[0];
      if (!target) throw new Error(`LIVE_AZURE_TARGET "${wanted}" is not a project in ${org}`);

      // DELETE moves the work item to the recycle bin rather than destroying it.
      const deleteWorkItem = (id: string) =>
        fetch(
          `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(target.name)}/_apis/wit/workitems/${id}?api-version=7.1`,
          { method: "DELETE", headers: { Authorization: authorization, Accept: "application/json" } },
        );

      const title = `Brief e2e ${new Date().toISOString()}`;
      let created: IssueResult | undefined;
      let deleted = false;
      try {
        created = await tracker.fileIssue({
          targetId: target.id,
          title,
          descriptionMarkdown: "**Steps to reproduce**\n\n1. Open the page\n2. Click Save",
          evidence: [
            { filename: "frame.png", contentType: "image/png", bytes: PNG, caption: "A single pixel" },
          ],
          details: [
            {
              title: "Network calls",
              markdown: "| Method | URL | Status |\n|---|---|---|\n| POST | /api/save | 500 |",
            },
          ],
        });
        expect(created.identifier).toBe(`${target.name}#${created.id}`);

        const read = await tracker.getIssue(created.identifier);
        expect(read.title).toBe(title);

        // The body landed in the field the work item's form actually shows,
        // with the screenshot inline, the logs, and the attribution.
        const raw = await fetch(
          `https://dev.azure.com/${encodeURIComponent(org)}/_apis/wit/workitems/${created.id}?$expand=relations&api-version=7.1`,
          { headers: { Authorization: authorization, Accept: "application/json" } },
        );
        expect(raw.status).toBe(200);
        const wi = (await raw.json()) as {
          fields: Record<string, unknown>;
          relations?: Array<{ rel: string }>;
        };
        const body = String(wi.fields[bodyField(String(wi.fields["System.WorkItemType"]))] ?? "");
        expect(body).toContain("<img");
        expect(body).toContain("Network calls");
        expect(body).toContain("Reported with");
        expect((wi.relations ?? []).filter((r) => r.rel === "AttachedFile")).toHaveLength(1);

        const details = await tracker.getTargetDetails(target.id);
        expect(details.states.length).toBeGreaterThan(0);
        // The second state is the first one a new work item can move to.
        const state = details.states[1] ?? details.states[0];
        const updated = await tracker.updateIssue(created.identifier, { state });
        expect(updated).toEqual({ ok: true });

        const live = await tracker.getLiveIssues([created.identifier]);
        expect(live.gone).toEqual([]);
        expect(live.issues[created.identifier]).toMatchObject({ title, stateName: state });

        // Delete it, then the feed must see it as gone. That only happens when
        // the recycle bin confirms the deletion, so this is the live check of
        // that confirmation, not just of the batch read omitting the item.
        const del = await deleteWorkItem(created.id);
        expect(del.ok).toBe(true);
        deleted = true;
        const after = await tracker.getLiveIssues([created.identifier]);
        expect(after.gone).toEqual([created.identifier]);
        expect(after.issues).toEqual({});
      } finally {
        // Backstop for a run that failed before the delete above.
        if (created && !deleted) {
          const del = await deleteWorkItem(created.id);
          // Warn, not expect: an assertion here would replace the error that
          // actually failed the test. A 404 means it is already gone.
          if (!del.ok && del.status !== 404) {
            console.warn(`[azure e2e] could not delete ${created.identifier}: ${del.status}`);
          }
        }
      }
    },
    120_000,
  );
});
