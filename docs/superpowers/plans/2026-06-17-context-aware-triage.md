# Context-Aware Autonomous Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the filing agent route, label, and fill fields autonomously by learning from the workspace's existing tickets — give it a `search_issues` tool plus team/project descriptions, and a triage-by-precedent prompt.

**Architecture:** This is **Phase 1** of the spec at [docs/superpowers/specs/2026-06-17-agentic-mcp-ticket-routing-design.md](docs/superpowers/specs/2026-06-17-agentic-mcp-ticket-routing-design.md). It adds the intelligence on the *current* direct-API agent loop, for both Linear and Jira, with no transport change. **Phase 2** (migrate Linear's transport to the official Linear MCP via the OpenAI Responses API) is a separate follow-up plan — see the final section. Phase 1 ships standalone: after it, the agent already files smarter for both providers.

**Tech Stack:** TypeScript, Next.js 16 (App Router), OpenAI SDK (`openai@^6.42`, `chat.completions`), Linear GraphQL, Jira REST v3, Vitest. Note: [web/AGENTS.md](web/AGENTS.md) warns this Next.js has breaking changes — but Phase 1 touches only `web/lib/**` modules (no routes/server components), so that caveat is not in play here.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `web/lib/tracker.ts` | Provider-agnostic types + interface | Add `IssueSearchResult`, `searchIssues()` to `Tracker`, `description?` on `TrackerTarget`/`TargetDetails` |
| `web/lib/jira.ts` | Jira REST adapter | Add `buildSearchJql`, `mapJiraSearchIssue`, `searchIssues()`; add project descriptions |
| `web/lib/linear.ts` | Linear GraphQL adapter | Add `mapLinearSearchIssue`, `searchIssues()`; add team descriptions |
| `web/lib/agent/process-brief.ts` | Agent loop + tools | Add `search_issues` tool + dispatch; render target descriptions; mention search in TOOLING |
| `web/lib/agent/system-prompt.ts` | Agent instructions | Rewrite for autonomous triage by precedent + custom fields |
| `web/lib/jira.test.ts` | Jira pure-helper tests | Add tests for `buildSearchJql` + `mapJiraSearchIssue` |
| `web/lib/linear.test.ts` | Linear pure-helper tests | New file: test `mapLinearSearchIssue` |

Pure helpers (`buildSearchJql`, `mapJiraSearchIssue`, `mapLinearSearchIssue`) are extracted so the search logic is unit-tested without HTTP; the `searchIssues()` methods are thin wrappers verified by typecheck/build.

---

## Task 1: Add search types to the tracker contract

**Files:**
- Modify: `web/lib/tracker.ts`

- [ ] **Step 1: Add the `description?` field to `TrackerTarget`**

In `web/lib/tracker.ts`, inside `interface TrackerTarget` (after the `assignees?` field, before the closing `}` at line 19), add:

```ts
  /** Short purpose/description of this destination (Linear team description / Jira project description), to help routing. */
  description?: string;
```

- [ ] **Step 2: Add the `description?` field to `TargetDetails`**

In `interface TargetDetails`, after `name: string;` (line 25), add:

```ts
  /** Short purpose/description of this destination, to help routing. */
  description?: string;
```

- [ ] **Step 3: Add the `IssueSearchResult` type**

Immediately after the `TargetDetails` interface closes (after line 43), add:

```ts
/** One existing issue returned by a precedent search, enriched so the agent can learn routing/labeling conventions. */
export interface IssueSearchResult {
  identifier: string;
  title: string;
  url: string;
  /** Where it lives: Linear team name / Jira project name. */
  target: string;
  /** Workflow state / status name. */
  state?: string;
  labels?: string[];
  assignee?: string;
  /** Normalized priority name (urgent/high/medium/low) where resolvable. */
  priority?: string;
  /** Jira issue type (Bug/Task/...). */
  issueType?: string;
  /** Linear project name, when set. */
  project?: string;
}
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: PASS (no new errors; we have not yet added the interface method, so existing adapters still compile).

- [ ] **Step 5: Commit**

```bash
git add web/lib/tracker.ts
git commit -m "feat(tracker): add IssueSearchResult type and target descriptions"
```

---

## Task 2: Jira precedent search (pure helpers, TDD)

**Files:**
- Modify: `web/lib/jira.ts`
- Test: `web/lib/jira.test.ts`

- [ ] **Step 1: Write failing tests for `buildSearchJql` and `mapJiraSearchIssue`**

In `web/lib/jira.test.ts`, extend the existing import from `"./jira"` to also import `buildSearchJql` and `mapJiraSearchIssue`. Then append:

```ts
describe("buildSearchJql", () => {
  it("builds a text search over summary and description, newest first", () => {
    expect(buildSearchJql("checkout coupon 500")).toBe(
      '(summary ~ "checkout coupon 500" OR description ~ "checkout coupon 500") ORDER BY updated DESC',
    );
  });

  it("strips quotes and backslashes to keep the JQL valid", () => {
    expect(buildSearchJql('a "b" \\c')).toBe(
      '(summary ~ "a b c" OR description ~ "a b c") ORDER BY updated DESC',
    );
  });

  it("falls back to a bare order-by when the query is empty", () => {
    expect(buildSearchJql("   ")).toBe("ORDER BY updated DESC");
  });
});

describe("mapJiraSearchIssue", () => {
  it("maps a Jira issue to an enriched search result", () => {
    const result = mapJiraSearchIssue(
      {
        key: "PAY-42",
        fields: {
          summary: "Coupon validation 500s",
          status: { name: "In Progress" },
          assignee: { displayName: "Jane Doe" },
          labels: ["area/billing", "type/bug"],
          priority: { name: "High" },
          project: { name: "Payments" },
          issuetype: { name: "Bug" },
        },
      },
      "https://acme.atlassian.net",
    );
    expect(result).toEqual({
      identifier: "PAY-42",
      title: "Coupon validation 500s",
      url: "https://acme.atlassian.net/browse/PAY-42",
      target: "Payments",
      state: "In Progress",
      labels: ["area/billing", "type/bug"],
      assignee: "Jane Doe",
      priority: "High",
      issueType: "Bug",
    });
  });

  it("tolerates missing fields", () => {
    const result = mapJiraSearchIssue({ key: "X-1", fields: {} }, "https://s.atlassian.net");
    expect(result.identifier).toBe("X-1");
    expect(result.title).toBe("");
    expect(result.target).toBe("");
    expect(result.labels).toEqual([]);
    expect(result.state).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run lib/jira.test.ts`
Expected: FAIL — `buildSearchJql` / `mapJiraSearchIssue` are not exported (import error).

- [ ] **Step 3: Implement the pure helpers**

In `web/lib/jira.ts`, after `markdownToAdf` ends (after line 152) and before the `// Auth + cloudId discovery` section header (line 154), add. Also add `IssueSearchResult` to the type import on line 2:

```ts
// ---------------------------------------------------------------------------
// Precedent search (pure helpers, unit-tested in jira.test.ts)
// ---------------------------------------------------------------------------

/** Build a JQL text search over summary+description for routing/labeling precedent. */
export function buildSearchJql(query: string): string {
  const q = query.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return "ORDER BY updated DESC";
  return `(summary ~ "${q}" OR description ~ "${q}") ORDER BY updated DESC`;
}

interface JiraSearchRaw {
  key: string;
  fields?: {
    summary?: string;
    status?: { name?: string };
    assignee?: { displayName?: string };
    labels?: string[];
    priority?: { name?: string };
    project?: { name?: string };
    issuetype?: { name?: string };
  };
}

/** Map a Jira search hit to the provider-agnostic IssueSearchResult. */
export function mapJiraSearchIssue(issue: JiraSearchRaw, siteUrl: string): IssueSearchResult {
  const f = issue.fields ?? {};
  return {
    identifier: issue.key,
    title: f.summary ?? "",
    url: `${siteUrl}/browse/${issue.key}`,
    target: f.project?.name ?? "",
    state: f.status?.name ?? undefined,
    labels: f.labels ?? [],
    assignee: f.assignee?.displayName ?? undefined,
    priority: f.priority?.name ?? undefined,
    issueType: f.issuetype?.name ?? undefined,
  };
}
```

Change line 2 from:

```ts
import { resolveName, type IssuePatch, type TargetDetails, type Tracker, type TrackerTarget, type UpdateResult } from "./tracker";
```

to:

```ts
import { resolveName, type IssuePatch, type IssueSearchResult, type TargetDetails, type Tracker, type TrackerTarget, type UpdateResult } from "./tracker";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run lib/jira.test.ts`
Expected: PASS (new tests green; existing `markdownToAdf`/`pickTransition` still green).

- [ ] **Step 5: Commit**

```bash
git add web/lib/jira.ts web/lib/jira.test.ts
git commit -m "feat(jira): add JQL precedent-search helpers"
```

---

## Task 3: Jira `searchIssues` method

**Files:**
- Modify: `web/lib/jira.ts`

- [ ] **Step 1: Add the `searchIssues` method to the returned tracker object**

In `makeJiraTracker`, inside the returned object, add this method right after the `listTargets()` method (after line 445, before `getTargetDetails`):

```ts
    async searchIssues(query: string, opts?: { limit?: number }): Promise<IssueSearchResult[]> {
      try {
        const jql = buildSearchJql(query);
        const fields = "summary,status,assignee,labels,priority,project,issuetype";
        const limit = Math.min(Math.max(opts?.limit ?? 15, 1), 50);
        const qs = `?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fields)}&maxResults=${limit}`;
        // Same endpoint dance as getJiraIssues: newer /search/jql, legacy /search on 404.
        let r = await jiraFetch(tok, base, `/search/jql${qs}`);
        if (r.status === 404) r = await jiraFetch(tok, base, `/search${qs}`);
        if (!r.ok) return [];
        const j = (await r.json()) as { issues?: Array<Parameters<typeof mapJiraSearchIssue>[0]> };
        return (j.issues ?? []).map((i) => mapJiraSearchIssue(i, cloud.siteUrl));
      } catch {
        return [];
      }
    },
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: PASS. (The method is an extra method on the object; the `Tracker` interface does not yet require it, so this compiles. We add the interface requirement in Task 5 once Linear also implements it.)

- [ ] **Step 3: Commit**

```bash
git add web/lib/jira.ts
git commit -m "feat(jira): implement searchIssues via JQL"
```

---

## Task 4: Linear precedent search (pure helper TDD + method)

**Files:**
- Modify: `web/lib/linear.ts`
- Test: `web/lib/linear.test.ts` (new)

- [ ] **Step 1: Write the failing test for `mapLinearSearchIssue`**

Create `web/lib/linear.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapLinearSearchIssue } from "./linear";

describe("mapLinearSearchIssue", () => {
  it("maps a Linear issue node to an enriched search result", () => {
    const result = mapLinearSearchIssue({
      identifier: "AI-12",
      title: "Agent picks wrong team",
      url: "https://linear.app/acme/issue/AI-12",
      priority: 2, // high
      state: { name: "Todo" },
      assignee: { displayName: "Sam", name: "sam@acme.com" },
      labels: { nodes: [{ name: "area/agent" }, { name: "type/bug" }] },
      team: { name: "AI" },
      project: { name: "Routing" },
    });
    expect(result).toEqual({
      identifier: "AI-12",
      title: "Agent picks wrong team",
      url: "https://linear.app/acme/issue/AI-12",
      target: "AI",
      state: "Todo",
      labels: ["area/agent", "type/bug"],
      assignee: "Sam",
      priority: "high",
      project: "Routing",
    });
  });

  it("tolerates missing fields and unknown priority", () => {
    const result = mapLinearSearchIssue({ identifier: "X-1", title: "t", url: "u", priority: 0 });
    expect(result.target).toBe("");
    expect(result.labels).toEqual([]);
    expect(result.assignee).toBeUndefined();
    expect(result.priority).toBeUndefined();
    expect(result.project).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run lib/linear.test.ts`
Expected: FAIL — `mapLinearSearchIssue` is not exported.

- [ ] **Step 3: Implement `mapLinearSearchIssue` and import the type**

In `web/lib/linear.ts`, change line 2 from:

```ts
import { resolveName, type IssuePatch, type TargetDetails, type Tracker, type TrackerPriority, type UpdateResult } from "./tracker";
```

to:

```ts
import { resolveName, type IssuePatch, type IssueSearchResult, type TargetDetails, type Tracker, type TrackerPriority, type UpdateResult } from "./tracker";
```

Then, immediately after the `LINEAR_PRIORITY` constant (after line 185), add:

```ts
interface LinearSearchNode {
  identifier: string;
  title?: string;
  url?: string;
  priority?: number;
  state?: { name?: string } | null;
  assignee?: { name?: string; displayName?: string } | null;
  labels?: { nodes?: Array<{ name: string }> } | null;
  team?: { name?: string } | null;
  project?: { name?: string } | null;
}

/** Map a Linear issue node to the provider-agnostic IssueSearchResult. */
export function mapLinearSearchIssue(node: LinearSearchNode): IssueSearchResult {
  const priorityName = (Object.entries(LINEAR_PRIORITY).find(([, v]) => v === node.priority) ?? [undefined])[0];
  return {
    identifier: node.identifier,
    title: node.title ?? "",
    url: node.url ?? "",
    target: node.team?.name ?? "",
    state: node.state?.name ?? undefined,
    labels: (node.labels?.nodes ?? []).map((l) => l.name),
    assignee: node.assignee?.displayName || node.assignee?.name || undefined,
    priority: typeof priorityName === "string" ? priorityName : undefined,
    project: node.project?.name ?? undefined,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run lib/linear.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the `searchIssues` method to the Linear tracker**

In `makeLinearTracker`, inside the returned object, add right after `listTargets()` (after line 289, before `getTargetDetails`):

```ts
    async searchIssues(query: string, opts?: { limit?: number }): Promise<IssueSearchResult[]> {
      const q = query.trim();
      if (!q) return [];
      const first = Math.min(Math.max(opts?.limit ?? 15, 1), 50);
      try {
        const d = await linearGraphQL<{ issues: { nodes: LinearSearchNode[] } }>(
          tok,
          `query IssueSearch($q: String!, $first: Int!) {
            issues(filter: { title: { containsIgnoreCase: $q } }, first: $first, orderBy: updatedAt) {
              nodes {
                identifier title url priority
                state { name }
                assignee { name displayName }
                labels { nodes { name } }
                team { name }
                project { name }
              }
            }
          }`,
          { q, first },
        );
        return (d.issues?.nodes ?? []).map(mapLinearSearchIssue);
      } catch {
        return [];
      }
    },
```

- [ ] **Step 6: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/lib/linear.ts web/lib/linear.test.ts
git commit -m "feat(linear): implement searchIssues via GraphQL title filter"
```

---

## Task 5: Require `searchIssues` on the Tracker interface

**Files:**
- Modify: `web/lib/tracker.ts`

- [ ] **Step 1: Add `searchIssues` to the interface**

In `web/lib/tracker.ts`, inside `interface Tracker`, add after the `listTargets()` line (after line 96):

```ts
  /**
   * Search EXISTING issues for routing/labeling precedent. Best-effort:
   * returns [] on any failure (a search outage must never break filing).
   */
  searchIssues(query: string, opts?: { limit?: number }): Promise<IssueSearchResult[]>;
```

- [ ] **Step 2: Typecheck (both adapters must now satisfy the interface)**

Run: `cd web && npx tsc --noEmit`
Expected: PASS — both `makeLinearTracker` and `makeJiraTracker` already implement `searchIssues` (Tasks 3 & 4).

- [ ] **Step 3: Commit**

```bash
git add web/lib/tracker.ts
git commit -m "feat(tracker): require searchIssues on the Tracker interface"
```

---

## Task 6: Populate target descriptions

**Files:**
- Modify: `web/lib/linear.ts`, `web/lib/jira.ts`

- [ ] **Step 1: Linear — fetch team descriptions**

In `web/lib/linear.ts`, in the `TeamMeta` type (lines 187-193), add a `description` field:

```ts
type TeamMeta = {
  name: string;
  key: string;
  description: string;
  states: Array<{ id: string; name: string }>;
  labels: Array<{ id: string; name: string }>; // workspace + this team's labels
  projects: Array<{ id: string; name: string }>;
};
```

In `loadTeamMeta`, add `description` to the GraphQL selection and to the map. Change the query teams selection (line 211) from `teams { nodes { id name key states ...` to include `description`:

```ts
        teams { nodes { id name key description states { nodes { id name } } labels { nodes { id name } } projects(first: 50) { nodes { id name } } } }
```

And update the typed shape on line 206 to include `description: string | null` on each team node, then in the `teamMeta = new Map(...)` mapping (around line 218-227) add `description: t.description ?? "",` alongside `name`/`key`.

- [ ] **Step 2: Linear — surface description in listTargets and getTargetDetails**

In `listTargets()` return mapping (lines 281-288), add `description: meta.description || undefined,`.
In `getTargetDetails()` return object (lines 297-305), add `description: meta.description || undefined,` after `name: meta.name,`.

- [ ] **Step 3: Jira — request project descriptions**

In `web/lib/jira.ts`, in `loadTargets()`, add the `expand=description` param and capture it. Change the fetch URL (line 387) to:

```ts
      const r = await jiraFetch(tok, base, `/project/search?expand=description&startAt=${startAt}&maxResults=50`);
```

Update the typed shape (lines 389-393) so each value includes `description?: string`, and the push (line 394) to:

```ts
      for (const p of j.values ?? []) out.push({ id: p.id, key: p.key, name: p.name, description: p.description || undefined });
```

- [ ] **Step 4: Jira — surface description in getTargetDetails**

In `getTargetDetails()` return object (lines 538-547), add `description: project.description || undefined,` after `name: project.name,`. (`project` here is the `TrackerTarget` from `loadTargets()`, which now carries `description`.)

- [ ] **Step 5: Typecheck + existing tests**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: PASS (no behavior tests cover descriptions; this verifies types + that nothing regressed).

- [ ] **Step 6: Commit**

```bash
git add web/lib/linear.ts web/lib/jira.ts
git commit -m "feat(tracker): surface team/project descriptions for routing"
```

---

## Task 7: Expose `search_issues` to the agent + render descriptions

**Files:**
- Modify: `web/lib/agent/process-brief.ts`

- [ ] **Step 1: Add the `search_issues` tool definition**

In `web/lib/agent/process-brief.ts`, in the `tools` array, insert this as a new entry right after the `list_targets` tool object (after line 58, before the `get_target_details` entry):

```ts
    {
      type: "function" as const,
      function: {
        name: "search_issues",
        description:
          `Search EXISTING ${noun === "team" ? "Linear" : "Jira"} issues to learn how this workspace files things like THIS report - which ${noun} similar issues live in, what labels and priority they carry, who owns them. Call this BEFORE choosing where to file. Use keywords from the failure (the error text, the failing endpoint/URL, the feature or page name); run a couple of searches with different keywords if the first is thin.`,
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Keywords to search for, e.g. \"checkout coupon 500\" or \"login redirect loop\".",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    },
```

- [ ] **Step 2: Dispatch the tool in the loop**

In `runLoop`'s `switch (tc.function.name)` block, add a case right after the `list_targets` case (after line 268):

```ts
            case "search_issues":
              result = await tracker.searchIssues(str(args.query) ?? "", { limit: 15 });
              break;
```

- [ ] **Step 3: Render target descriptions in the seeded target list**

In the `targetList` builder (lines 187-196), add a description line. Change the `.map((t) => { ... })` body to insert, right after the `let line = ...` line (line 190):

```ts
      if (t.description) line += `\n  about: ${t.description}`;
```

- [ ] **Step 4: Mention search in the TOOLING preamble**

In the `sys` string's TOOLING sentence (line 36), insert a sentence about `search_issues` at the very start of the backtick block, right after `TOOLING: You drive the tracker through tools, MCP-style. `:

```
search_issues(query) looks up EXISTING issues so you can route and label by precedent - call it before picking a ${noun}.
```

So the line becomes `...MCP-style. search_issues(query) looks up EXISTING issues so you can route and label by precedent - call it before picking a ${noun}. list_targets shows where you can file. ...` (leave the rest unchanged).

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/lib/agent/process-brief.ts
git commit -m "feat(agent): add search_issues tool and render target descriptions"
```

---

## Task 8: Rewrite the system prompt for autonomous triage

**Files:**
- Modify: `web/lib/agent/system-prompt.ts`

- [ ] **Step 1: Replace `SYSTEM_PROMPT` with the triage-by-precedent version**

Replace the entire `SYSTEM_PROMPT` template literal (lines 5-49) with:

```ts
export const SYSTEM_PROMPT = `
You are a senior engineer turning a captured bug or feature report into exactly one high-quality tracker ticket (Linear or Jira), filed in the RIGHT place with the RIGHT fields, then stopping. You decide every judgement call autonomously - NEVER ask the user anything.

WHAT YOU'RE GIVEN
- A JSON object describing the report. It may include any of: a typed description, a spoken narration ("transcript") and time-stamped chunks, page events, console errors, the page URL/title, and flags.
- Zero or more screenshots as images (sampled frames from a screen capture, and/or an annotated screenshot). On an annotated screenshot, RED markings are the reporter pointing at where the problem is - treat the red as a focus indicator, not part of the product UI.

GROUND TRUTH
- Treat any narration/transcript as a ROUGH DRAFT - speech-to-text is mediocre on accents, jargon, and code. The screenshots, page URL, console errors, and events are ground truth. Silently correct obvious mis-transcriptions; never quote the narration.
- Use whatever is present (a full capture, just a screenshot, just a sentence of text, or a mix). Never assume a screen capture exists.

CORRELATE THE EVIDENCE
- Reason across ALL signals together before writing - time-ordered screen frames, an optional annotated screenshot (RED marks = where the reporter is pointing), the spoken narration, page events (clicks/keys/navigation), console/runtime errors, and the page URL/title. Reconstruct the actual sequence (what the user did, what they saw, what went wrong) and tie the visible symptom to the console error or event that explains it.
- When signals conflict, trust the screenshots, console errors, and events over the narration. If the evidence is genuinely ambiguous, write only what it supports - don't speculate.

UNDERSTAND THE FAILURE BEFORE YOU ROUTE
- Work out what actually broke and WHERE IT LIVES, not just where it surfaced. A symptom visible in the UI is often caused elsewhere: a failing request or 500 in the console points at the service that OWNS that endpoint, not the page that called it. Route to the team that owns the root cause.

LEARN HOW THIS WORKSPACE FILES (before you choose)
- Call search_issues with keywords from the failure (the error text, the failing endpoint/URL, the feature or page name) to see how SIMILAR issues were already filed: which team/project they live in, what labels and priority they carry, who owns them. Run a couple of searches with different keywords if the first returns little.
- Use what you find as PRECEDENT: file into the same team/project comparable issues go to, apply the labels those tickets use (prefer an existing label over inventing one), and match their priority calibration. When precedent is missing or mixed, fall back to the targets' descriptions and the nature of the issue.

CHOOSE THE TARGET
- Pick the team/project whose purpose (each target's "about" description and its name) matches the root cause, reinforced by the precedent from search_issues. With overlapping candidates, prefer the one that owns the failing layer (e.g. the service that owns the API over the team that owns the page).
- A user's standing preference about routing always overrides your own judgement (see USER PREFERENCES).

WRITE IT LIKE A TEAMMATE FILED IT FROM SCRATCH
- Title: concise and specific - the problem, not a summary of the report. No fluff.
- Description (Markdown). Use only the sections you can fill honestly - never pad, never invent details:
  - A one or two sentence summary of the problem and its user impact.
  - **Steps to reproduce** - a numbered list, when the events/narration/screens make the sequence clear.
  - **Expected** and **Actual** - one line each, for bugs.
  - For a feature request: the desired behaviour and the reason it matters.
  - Include console errors verbatim (in a code block) when present and relevant.
  - Plain punctuation only: never use an em-dash or en-dash. Use periods, commas, colons, or parentheses instead. (Hyphens in compound words are fine.)
  - **Context** - ALWAYS include the page URL when one is present (and the browser if relevant), e.g. a short "Environment" or "Context" line. A teammate must be able to see where this happened.
- Keep it tight and skimmable. A short, correct ticket beats a long speculative one.

FIELDS - SET WHAT THE WORKSPACE EXPECTS
- Labels: apply the labels comparable issues use (from search_issues and the target's label list). Don't invent a new taxonomy; reuse existing names.
- Priority: calibrate to user impact and to how similar issues were rated.
- Custom fields (Jira especially): get_target_details lists the target's settable fields with their ids and allowed values. When the issue clearly determines a field that comparable tickets set (e.g. a Component, Severity, or Environment), set it via custom_fields using one of its allowed values - WITHOUT being told to. Only set a field you can fill correctly from the evidence or precedent; never guess a value you cannot determine.

EVIDENCE
- You are told which evidence files exist (the EVIDENCE AVAILABLE list) and choose which to attach - pick the minimal set that PROVES the issue; the system uploads and embeds your selection. A recording is only attachable when the user allowed it; if it was excluded, never attach it or allude to it.
- In the title/description: do NOT invent image URLs, do NOT paste data: URIs, and do NOT reference file names or attachment names. Refer to what's visible naturally ("the checkout page shows...") as if the reader sees the evidence inline.

BANNED VOCABULARY (never appears in the title or description)
- "brief"/"briefs", any capture id; "recording"/"recorded"/"captured"/"capture" (as a tool/noun); "transcript"/"voice"/"narrated"/"the user said"/"the reporter said"; "keyframe"/"frame at 0:02"/any media timestamp; file paths or file names; phrases like "in the recording" or "as shown in the video". The ticket is about the issue and its evidence - nothing about how it was captured.

USER PREFERENCES
- The user may provide standing ticket preferences (routing rules, default status, assignee, project, labels, priority, custom fields, an automatic comment, tone, required sections). Treat them as BINDING instructions that OVERRIDE your own judgement, and apply each through the mechanism it maps to: routing to the team/project you pick; status/assignee/project/labels/priority to the matching create_issue parameters; tracker-specific or custom fields to custom_fields; "comment that it's in progress" to the comment parameter; wording/format to the title and description.
- Use the names from the target's details (states / labels / members / projects / custom fields) when resolving a preference - e.g. "assign to Devin" sets the assignee parameter to the matching member name.
- When a preference is conditional ("bugs to Engineering, features to Product"), evaluate the condition against THIS report and apply the matching branch. They never override the banned-vocabulary or evidence rules.

PROCESS
- search_issues for precedent, then pick the best team/project, then call get_target_details whenever you will set a status/assignee/project/label/custom field (use the real names it returns), then create exactly ONE issue.
- VERIFY AND REPAIR: after creating, if you set anything beyond title/description, call get_issue and check EVERY field actually landed (status, assignee, project, labels, priority, custom fields). Anything missing or wrong, fix it with update_issue (its errors list the valid options - use them and retry once with a corrected value). Stop when the issue matches, or when a field genuinely cannot be applied in this tracker (then leave it - never invent a workaround that violates other rules).
`.trim();
```

- [ ] **Step 2: Typecheck + full test run**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: PASS (prompt is a string; no test asserts its text).

- [ ] **Step 3: Commit**

```bash
git add web/lib/agent/system-prompt.ts
git commit -m "feat(agent): rewrite prompt for autonomous triage by precedent"
```

---

## Task 9: Build + lint + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Lint and build the web app**

Run: `cd web && npm run lint && npm run build`
Expected: PASS (no type or lint errors).

- [ ] **Step 2: Full test suite**

Run: `cd web && npx vitest run`
Expected: PASS — `jira.test.ts` (markdownToAdf, pickTransition, buildSearchJql, mapJiraSearchIssue), `linear.test.ts` (mapLinearSearchIssue), `tracker.test.ts` (resolveName), `evidence.test.ts`, `context-block.test.ts`, `transcribe.test.ts` all green.

- [ ] **Step 3: Manual smoke (live, behind a real connected tracker)**

With a Linear (or Jira) account connected, file a brief whose root cause differs from its surface (e.g. a UI action that fails on a backend 500). Confirm in the dev logs that the agent calls `search_issues` before `create_issue`, and that the resulting ticket lands in a sensible team with labels consistent with existing tickets. This is a behavioral check, not an assertion; note the outcome.

- [ ] **Step 4: Commit (only if Step 1-3 surfaced fixes)**

```bash
git add -A
git commit -m "fix(agent): address smoke-test findings for context-aware triage"
```

---

## Self-Review

**Spec coverage (Phase 1 scope):**
- "Search existing issues (precedent)" -> Tasks 2-5 (`searchIssues` both providers) + Task 7 (tool). ✓
- "Team/project descriptions in discovery" -> Task 6. ✓
- "Autonomous routing by ownership + precedent" -> Task 8 prompt. ✓
- "Tag by precedent / custom fields by example without config" -> Task 8 (FIELDS section). ✓
- "No dedup" -> prompt contains no dedup instruction. ✓
- "Both providers, multi-tenant, attachments intact, no transport change" -> no change to auth/evidence/loop in Phase 1. ✓
- Linear MCP transport + linear.ts shrink + Responses API -> **deferred to Phase 2** (next plan), per the spec's §3.1/§6. Intentional, stated below.

**Placeholder scan:** No TBD/TODO; every code/test step shows complete code; every run step states expected output. ✓

**Type consistency:** `IssueSearchResult` defined in Task 1 is used identically in Tasks 2 (`mapJiraSearchIssue`), 4 (`mapLinearSearchIssue`), 3 & 4 (`searchIssues` return), and 5 (interface). `searchIssues(query, opts?: { limit?: number })` signature matches across interface (Task 5) and both implementations (Tasks 3, 4). `description?` added to `TrackerTarget`/`TargetDetails` (Task 1) and populated (Task 6) and rendered (Task 7) consistently. ✓

---

## Phase 2 (separate follow-up plan): Linear transport → official Linear MCP

Not part of this plan's executable tasks (it depends on live-API specifics that must be verified, not guessed). After Phase 1 lands, write `docs/superpowers/plans/<date>-linear-mcp-transport.md` covering, per the spec §3.1/§3.3/§6:

1. **Verify-first tasks:** read the installed `openai` SDK's Responses types in `web/node_modules/openai` for the exact `responses.create` + `mcp` tool shape; probe `https://mcp.linear.app/mcp` with a scoped token to confirm `list_issues`/`save_issue` params and that the Clerk `oauth_linear` token authenticates (and carries `write`/`issues:create` scope — the §7 prerequisite).
2. Migrate `process-brief.ts` from `chat.completions` to `responses.create`; Linear branch attaches the remote `mcp` tool (`require_approval: "never"`, `allowed_tools`), Jira branch keeps the local function tools (including this phase's `search_issues`).
3. Linear evidence: backend pre-upload via `uploadAsset` + embed assetUrls in the agent's input context + post-create recording-embed safety net.
4. Shrink `web/lib/linear.ts` to `getLinearToken`, `makeLinearApi`/`uploadAsset`, and `getIssuesByIdentifiers`; retire `makeLinearTracker` from the filing path.
5. Tests: request-assembly unit tests with a mocked `responses.create`; live smoke behind a flag.
