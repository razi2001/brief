# Seven More Trackers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brief files tickets into Azure DevOps, ClickUp, Trello, Notion, GitLab, Asana and Monday, each shaped to that tracker's grain, alongside Linear, Jira and GitHub.

**Architecture:** One `Tracker` adapter per provider behind the existing registry (`web/lib/trackers/registry.ts`). Notion and GitLab are Clerk connected accounts; Azure DevOps, ClickUp, Trello, Asana and Monday go through Brief's own OAuth with encrypted tokens in a new `tracker_connections` table. A generic workspace pick (generalizing today's GitHub org picker) gives every provider an org identity and, where needed, a filing scope.

**Tech Stack:** Next.js 16 App Router (TS), Clerk 7.4.3, Supabase (service role), vitest, provider REST/GraphQL APIs via `fetch`.

Spec: `docs/superpowers/specs/2026-10-13-seven-trackers-design.md`.

> **Superseded for GitLab and Notion.** After this plan ran, both moved to Brief-held OAuth like Azure DevOps (production Clerk refuses a fourth social connection on its plan). The Clerk steps below for those two, and the Clerk setup script, no longer apply; the spec's Auth section has the current design.

**Source for ported code:** branch `origin/claude/ticket-integrations-structure-488686` (call it `OLD`). Read a file with `git show OLD:web/lib/azure.ts`. Port = copy, then apply the listed changes. Never merge that branch.

---

## Ground rules for every task

- Work in `web/`. Commands run from `web/`: `npx tsc --noEmit`, `npx vitest run <files>`, `npx eslint <files>`.
- Read `web/AGENTS.md`: this Next.js has breaking changes; route `params` are `Promise<{...}>`; the middleware file is `proxy.ts`.
- Comment density and voice match the surrounding code: explain WHY, plain sentences, **no em/en dashes anywhere (code comments, copy, prompts)** - use a hyphen or a comma.
- UI copy: labels and controls only, no instructional sentences.
- Never print a token. Tests stub `fetch` with `vi.stubGlobal("fetch", ...)` and `afterEach(() => vi.unstubAllGlobals())`.
- Every adapter failure in a best-effort path (`searchIssues`, `getLiveIssues`, `listTargets` sub-calls) degrades, never throws out.
- Commit after each task with a message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Shared contracts (defined in Task 1, used everywhere)

```ts
// web/lib/tracker.ts
export type ProviderKey =
  | "linear" | "jira" | "github" | "gitlab" | "azure"
  | "clickup" | "notion" | "trello" | "asana" | "monday";

/** One workspace/org/group a token can see. The workspace pick is one of these. */
export type Workspace = { id: string; name: string; avatarUrl?: string };
```

Adapter module contract, `web/lib/<provider>.ts`:

| Module | Auth type | Exports |
|---|---|---|
| `azure.ts` | `AzureTok = { org: string; authorization: string }` (`"Bearer x"` or `"Basic base64(:pat)"`) | `makeAzureTracker(tok)`, `listAzureOrgs(authorization): Promise<Workspace[]>` (id = accountName) |
| `clickup.ts` | `ClickUpTok = { token: string; teamId?: string }` | `makeClickUpTracker(tok)`, `listClickUpWorkspaces(token): Promise<Workspace[]>` |
| `trello.ts` | `TrelloTok = { key: string; token: string }` | `makeTrelloTracker(tok)`, `listTrelloWorkspaces(tok): Promise<Workspace[]>` |
| `notion.ts` | `NotionTok = { token: string }` | `getNotionToken(userId)`, `makeNotionTracker(tok)`, `listNotionWorkspaces(tok): Promise<Workspace[]>` (exactly one) |
| `gitlab.ts` | `GitlabTok = { token: string; baseUrl?: string }` | `getGitlabToken(userId)`, `makeGitlabTracker(tok)`, `listGitlabGroups(tok): Promise<Workspace[]>` |
| `asana.ts` | `AsanaTok = { token: string; workspaceGid: string }` | `makeAsanaTracker(tok)`, `listAsanaWorkspaces(token): Promise<Workspace[]>` |
| `monday.ts` | `MondayTok = { token: string }` | `makeMondayTracker(tok)`, `listMondayAccount(tok): Promise<Workspace[]>` (exactly one) |

Identifiers (round-trip through `updateIssue`/`getIssue`/`getLiveIssues`): Azure `Project#123`, ClickUp task id, Trello card shortLink, Notion page id, GitLab `group/sub/project#12` (GitLab's `references.full`), Asana task gid, Monday item id.

Technical logs (`IssueInput.details`, `Array<{title, markdown}>`), per adapter:
Azure appends `<h3>title</h3>` + `mdToHtml(markdown)` after the evidence in the body field; ClickUp appends `### title` + markdown to `markdown_description`; Notion appends one `toggle` block per section whose children are `markdownToBlocks(markdown)`; GitLab uses `withGithubDetails` (GitLab renders `<details>`); Trello, Asana and Monday upload ONE file `technical-logs.md` (`text/markdown`, sections joined with `## title`) and say nothing about it in the body.

Live tests: `web/lib/<provider>.e2e.test.ts`, `describe.skipIf(!process.env.LIVE_<X>)`. Run with
`node --env-file=C:/Users/razif/src_perso/brief-cloud/web/.env.local node_modules/vitest/vitest.mjs run lib/<provider>.e2e.test.ts`.
Env: `LIVE_AZURE_PAT` + `LIVE_AZURE_ORG`, `LIVE_CLICKUP_TOKEN`, `LIVE_TRELLO_KEY` + `LIVE_TRELLO_TOKEN`, `LIVE_NOTION_TOKEN`, `LIVE_GITLAB_TOKEN`, `LIVE_ASANA_TOKEN`, `LIVE_MONDAY_TOKEN`. Each live test: list workspaces, list targets, pick the first target (or `LIVE_<X>_TARGET`), file a ticket titled `Brief e2e <iso time>` with a 1x1 PNG evidence and one details section, `getIssue`, `updateIssue` with a state from `getTargetDetails`, `getLiveIssues([identifier])` expects the identifier in `issues`, then delete/archive the ticket through the provider API directly.

---

## File map

Create:
- `web/supabase/migrations/0014_tracker_connections.sql` - owned-connection table.
- `web/lib/oauth-state.ts` (+ `.test.ts`) - HMAC-signed OAuth state. Port OLD.
- `web/lib/connections.ts` (+ `.test.ts`) - owned OAuth specs, encrypted store, refresh.
- `web/lib/workspaces.ts` (+ `.test.ts`) - list / get pick / set pick per provider.
- `web/app/api/connect/[provider]/start/route.ts`, `callback/route.ts`, `disconnect/route.ts` - owned OAuth flow. Port OLD + Asana/Monday + workspace.
- `web/app/api/me/connections/route.ts` - owned connections + configured flags for the client.
- `web/app/api/org/workspace/route.ts` - generic workspace picker API.
- `web/lib/azure.ts`, `clickup.ts`, `trello.ts`, `notion.ts`, `notion-blocks.ts` (+ tests) - ported adapters.
- `web/lib/gitlab.ts`, `asana.ts`, `asana-html.ts`, `monday.ts` (+ tests) - new adapters.
- `web/lib/<provider>.e2e.test.ts` x7 - live tests.
- `web/components/WorkspacePicker.tsx` - generic picker (replaces `GithubOrgPicker`).
- `web/scripts/setup-trackers.mjs` - Clerk prod Notion/GitLab credentials + Fly secrets checklist.
- `web/TRACKERS.md` - app registration per provider.

Modify:
- `web/lib/tracker.ts` - `ProviderKey`, `Workspace`.
- `web/lib/trackers/registry.ts` - entries, `auth`, async connected list.
- `web/lib/clerk-strategies.ts` - `notion`, `gitlab` built-ins; GitLab `api` extra scope.
- `web/lib/org-server.ts` - resolve org for every provider through `workspaces.ts`.
- `web/lib/briefs-server.ts`, `web/lib/tracker-health.ts`, `web/lib/ticket-sync.ts` - owned providers, host patterns, short identifiers.
- `web/lib/agent/process-brief.ts` - help text for gitlab/asana/monday; `search_issues` wording.
- `web/components/provider-labels.ts`, `TrackerLogo.tsx`, `useTrackerConnect.ts`, `Integrations.tsx`, `TrackerPicker.tsx`, `Onboarding.tsx`, `SettingsView.tsx`, `TicketPreferences.tsx`.
- `web/app/(main)/connections/page.tsx`, `web/app/api/me/route.ts`, `web/app/api/org/github/route.ts` (delegate to workspace route).
- `web/lib/guide/lessons.ts`, `web/app/privacy/page.tsx`, `web/.env.local.example`, `extension/popup.js`.

---

### Task 1: Provider keys and the Workspace type

**Files:** Modify `web/lib/tracker.ts`, `web/components/provider-labels.ts`, `web/lib/clerk-strategies.ts`, `web/lib/clerk-strategies.test.ts`.

- [ ] **Step 1:** In `tracker.ts` replace `export type ProviderKey = "linear" | "jira" | "github";` with the union in Shared contracts, add the `Workspace` type below it, and update the header comment's list of adapter files and the `targetNoun` doc ("team" Linear, "project" Jira/Azure/GitLab/Asana, "repository" GitHub, "list" ClickUp, "board" Trello/Monday, "database" Notion). Restore OLD's capability doc comments (projects: "Linear projects, ADO area paths, Monday groups"; states: "Trello: which list"; customFields: "Jira, ADO, ClickUp, Notion, GitLab, Asana, Monday"; issueTypes: "Jira, ADO").
- [ ] **Step 2:** `provider-labels.ts`: same union, labels `gitlab: "GitLab", azure: "Azure DevOps", clickup: "ClickUp", notion: "Notion", trello: "Trello", asana: "Asana", monday: "Monday"`.
- [ ] **Step 3:** `clerk-strategies.ts`: `BUILT_IN` gains `notion: "oauth_notion", gitlab: "oauth_gitlab"`; `OVERRIDE` gains `notion: process.env.NEXT_PUBLIC_NOTION_CLERK_STRATEGY, gitlab: process.env.NEXT_PUBLIC_GITLAB_CLERK_STRATEGY`; `EXTRA_SCOPES` gains `gitlab: ["api"]` with a comment: creating an issue needs `api`; GitLab has no narrower write scope.
- [ ] **Step 4:** Add to `clerk-strategies.test.ts`:

```ts
it("GitLab asks for api, Notion asks for nothing extra", () => {
  expect(clerkStrategy("gitlab")).toBe("oauth_gitlab");
  expect(extraScopes("gitlab")).toEqual(["api"]);
  expect(clerkStrategy("notion")).toBe("oauth_notion");
  expect(extraScopes("notion")).toBeUndefined();
});
```

- [ ] **Step 5:** `npx vitest run lib/clerk-strategies.test.ts` PASS. `npx tsc --noEmit` will now report every `Record<ProviderKey, ...>` that is incomplete; fix only `provider-labels.ts` here (others are owned by later tasks; list the remaining errors in the commit body).
- [ ] **Step 6:** Commit `feat(web): provider keys for seven more trackers`.

### Task 2: Owned-connection vault

**Files:** Create `web/supabase/migrations/0014_tracker_connections.sql`, `web/lib/oauth-state.ts`, `web/lib/oauth-state.test.ts`, `web/lib/connections.ts`, `web/lib/connections.test.ts`.

- [ ] **Step 1:** Migration = `git show OLD:web/supabase/migrations/0010_tracker_connections.sql`, renamed 0014, header comment updated: owned providers are `azure, clickup, trello, asana, monday`; Notion and GitLab are Clerk accounts; `account_meta` holds `workspaceId`, `workspaceName`, `label` and provider handles.
- [ ] **Step 2:** Port `oauth-state.ts` and its test from OLD unchanged except `OAuthState.provider` typed `OwnedProvider`. Run its test: PASS.
- [ ] **Step 3:** Port `connections.ts` from OLD with these changes:
  - `OwnedProvider = "azure" | "clickup" | "trello" | "asana" | "monday"`.
  - `azure` spec reads `AZURE_DEVOPS_CLIENT_ID` / `AZURE_DEVOPS_CLIENT_SECRET`.
  - Add specs:
    ```ts
    asana: {
      authorizeUrl: "https://app.asana.com/-/oauth_authorize",
      tokenUrl: "https://app.asana.com/-/oauth_token",
      clientId: () => process.env.ASANA_CLIENT_ID,
      clientSecret: () => process.env.ASANA_CLIENT_SECRET,
      // Empty = the permissions configured on the Asana app itself.
      scope: process.env.ASANA_SCOPES ?? "",
    },
    monday: {
      authorizeUrl: "https://auth.monday.com/oauth2/authorize",
      tokenUrl: "https://auth.monday.com/oauth2/token",
      clientId: () => process.env.MONDAY_CLIENT_ID,
      clientSecret: () => process.env.MONDAY_CLIENT_SECRET,
      scope: "me:read boards:read boards:write updates:write users:read workspaces:read assets:read",
    },
    ```
  - `Connection.meta` stays `Record<string, string>`; add `export function connectionWorkspace(c: Connection): Workspace | null` returning `{ id: meta.workspaceId, name: meta.workspaceName || meta.workspaceId }` or null.
  - `saveConnection` and both deletes must check supabase's `{ error }` and throw `new Error(error.message)` (supabase-js resolves, it does not reject).
  - Add `export async function setConnectionMeta(userId, provider, patch: Record<string,string>)` that merges into `account_meta` (read row, spread, update; throws on error).
  - `refresh` omits `scope` from the body when `spec.scope` is empty.
  - `listConnectedProviders` is wrapped in React `cache` (import `{ cache } from "react"`), so one render reads the table once.
- [ ] **Step 4:** Write `connections.test.ts` (mock `@/lib/supabase/server` with `vi.mock`, an in-memory table keyed `user_id|provider`; `CONNECTIONS_KEY` = `Buffer.alloc(32, 7).toString("base64")` via `vi.stubEnv`):

```ts
it("stores tokens encrypted and reads them back", async () => {
  await saveConnection("u1", "clickup", { accessToken: "tok-1", meta: { workspaceId: "9", workspaceName: "Acme" } });
  expect(JSON.stringify(rows())).not.toContain("tok-1");
  const c = await getConnection("u1", "clickup");
  expect(c?.accessToken).toBe("tok-1");
  expect(connectionWorkspace(c!)).toEqual({ id: "9", name: "Acme" });
});
it("refreshes an expiring token and keeps the old refresh token when none comes back", async () => { /* expires_at in the past; fetch stub answers {access_token:"new", expires_in:3600}; expect "new" and the stored refresh token unchanged */ });
it("returns null when the refresh is refused", async () => { /* fetch -> {ok:false,status:400} */ });
it("isProviderConfigured needs CONNECTIONS_KEY and the client credentials", () => { /* trello needs only TRELLO_API_KEY */ });
it("saveConnection throws when supabase reports an error", async () => { /* upsert -> { error: { message: "boom" } } */ });
```

Fill each body fully (no comments-as-code in the committed test).
- [ ] **Step 5:** `npx vitest run lib/connections.test.ts lib/oauth-state.test.ts` PASS. Commit `feat(web): an encrypted vault for trackers Clerk can't hold`.

### Task 3: Notion adapter (port)

**Files:** Create `web/lib/notion.ts`, `notion-blocks.ts`, `notion.test.ts`, `notion-blocks.test.ts`, `notion.e2e.test.ts`.

- [ ] **Step 1:** Port the four files from OLD.
- [ ] **Step 2:** `fileIssue` renders `details`: after the evidence blocks, append for each non-empty section `{ type: "toggle", toggle: { rich_text: [{ type:"text", text:{ content: title }}], children: markdownToBlocks(markdown).slice(0, 100) } }` (Notion caps children per block at 100; the append path in `batchBlocks` already handles the page-level cap). Then the attribution block.
- [ ] **Step 3:** Add `export async function listNotionWorkspaces(tok: NotionTok): Promise<Workspace[]>`: `GET /v1/users/me` → `bot.workspace_id ?? bot.workspace_name` as id, `bot.workspace_name` as name; `[]` on any failure.
- [ ] **Step 4:** Tests: a `details` case asserting a toggle block with the section title and a child paragraph; `listNotionWorkspaces` with and without `workspace_id`.
- [ ] **Step 5:** e2e test per the Shared contracts recipe (`LIVE_NOTION_TOKEN`; the integration must be shared with one database). Delete = `PATCH /v1/pages/:id { archived: true }`.
- [ ] **Step 6:** `npx vitest run lib/notion*.test.ts` PASS, tsc clean for these files. Commit `feat(web): file tickets to Notion`.

### Task 4: Azure DevOps adapter (port)

**Files:** Create `web/lib/azure.ts`, `azure.test.ts`, `azure.e2e.test.ts`.

- [ ] **Step 1:** Port from OLD. Change `AzureTok` to `{ org: string; authorization: string }`; the request helper sends `Authorization: tok.authorization` (not `Bearer ${token}`), so a PAT (`Basic`) and an Entra token (`Bearer`) both work.
- [ ] **Step 2:** `details`: in `fileIssue`, after the evidence HTML, append `details.map(d => `<h3>${escape(d.title)}</h3>${mdToHtml(d.markdown)}`)` inside the same body field (Repro Steps for a Bug, Description otherwise).
- [ ] **Step 3:** Add `export async function listAzureOrgs(authorization: string): Promise<Workspace[]>`: `GET https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1` → `id`; then `GET https://app.vssps.visualstudio.com/_apis/accounts?memberId=<id>&api-version=7.1` → `value[].accountName` as both `id` and `name`. `[]` on failure.
- [ ] **Step 4:** Tests: authorization header passthrough (Basic and Bearer); details land in `Microsoft.VSTS.TCM.ReproSteps` for a Bug; `listAzureOrgs` two-call chain.
- [ ] **Step 5:** e2e with `LIVE_AZURE_PAT`, `LIVE_AZURE_ORG` (authorization = `Basic ${Buffer.from(":" + pat).toString("base64")}`); `listAzureOrgs` is skipped for PATs scoped to one org (assert it returns an array). Delete = `DELETE /{project}/_apis/wit/workitems/{id}?api-version=7.1` (recycle bin).
- [ ] **Step 6:** Tests PASS. Commit `feat(web): file work items to Azure DevOps`.

### Task 5: ClickUp adapter (port)

**Files:** Create `web/lib/clickup.ts`, `clickup.test.ts`, `clickup.e2e.test.ts`.

- [ ] **Step 1:** Port from OLD. `loadTeams` uses `tok.teamId` when set (the workspace pick) and only falls back to every team when it is not.
- [ ] **Step 2:** `details`: append `\n\n### ${title}\n\n${markdown}` per section to `markdown_description` before the attribution.
- [ ] **Step 3:** `export async function listClickUpWorkspaces(token: string): Promise<Workspace[]>`: `GET /api/v2/team` → `teams[]` `{ id, name, avatar }`.
- [ ] **Step 4:** Tests: teamId scoping (only `/team/<id>/space` is called); details in `markdown_description`; workspace list.
- [ ] **Step 5:** e2e with `LIVE_CLICKUP_TOKEN` (personal tokens use the raw token as Authorization, same as OAuth). Delete = `DELETE /api/v2/task/:id`.
- [ ] **Step 6:** PASS. Commit `feat(web): file tasks to ClickUp`.

### Task 6: Trello adapter (port)

**Files:** Create `web/lib/trello.ts`, `trello.test.ts`, `trello.e2e.test.ts`.

- [ ] **Step 1:** Port from OLD.
- [ ] **Step 2:** `details`: when non-empty, upload one extra attachment `technical-logs.md` (`text/markdown`; body = sections joined as `## ${title}\n\n${markdown}`) through the same attachment path as evidence, AFTER the screenshots so the cover stays the first screenshot.
- [ ] **Step 3:** First screenshot becomes the cover: attach with `setCover=true` on the first `image/*` evidence only.
- [ ] **Step 4:** `export async function listTrelloWorkspaces(tok: TrelloTok): Promise<Workspace[]>`: `GET /1/members/me/organizations?fields=id,displayName,logoUrl`.
- [ ] **Step 5:** Tests: technical-logs.md uploaded last with text/markdown; cover only on the first image; workspace list.
- [ ] **Step 6:** e2e with `LIVE_TRELLO_KEY` + `LIVE_TRELLO_TOKEN`. Delete = `DELETE /1/cards/:id`.
- [ ] **Step 7:** PASS. Commit `feat(web): file cards to Trello`.

### Task 7: GitLab adapter (new)

**Files:** Create `web/lib/gitlab.ts`, `gitlab.test.ts`, `gitlab.e2e.test.ts`.

Model it on `web/lib/github.ts` (structure, comments, best-effort rules). API base `${tok.baseUrl ?? "https://gitlab.com"}/api/v4`, header `Authorization: Bearer ${token}` (OAuth and PATs).

- [ ] **Step 1: Token.** `getGitlabToken(userId)` mirrors `getGithubToken` with `clerkStrategy("gitlab")`.
- [ ] **Step 2: Targets.** `targetNoun: "project"`. `listTargets`: `GET /projects?membership=true&min_access_level=20&archived=false&with_issues_enabled=true&order_by=last_activity_at&per_page=100` (up to 2 pages) → `{ id: String(p.id), key: p.path_with_namespace, name: p.name_with_namespace, description: describeRepo({ description: p.description, topics: p.topics }) }` (`describeRepo` from `@/lib/github`; GitLab has no homepage field).
- [ ] **Step 3: Capabilities.** `{ ...NO_CAPABILITIES, states: true, priority: true, labels: true, customFields: true, comments: true, nativeAttachments: true }`. `bodyGuidance`: "GitLab renders Markdown; section labels become headings."
- [ ] **Step 4: Details.** `getTargetDetails(id)`: labels `GET /projects/:id/labels?per_page=100&include_ancestor_groups=true`; members `GET /projects/:id/members/all?per_page=100` → `"Name (@username)"`; milestones `GET /projects/:id/milestones?state=active&per_page=50&include_ancestors=true`. `states` = `["Open", ...statusLabels, "Closed"]` where statusLabels are label names matching `/^(workflow|status|state)::/i`. `customFields`: `milestone` (allowedValues = titles), `due_date` (type date), `weight` (number), `confidential` (boolean), `issue_type` (allowedValues `issue`, `incident`).
- [ ] **Step 5: Evidence + body.** `fileIssue`: upload each evidence file `POST /projects/:id/uploads` (multipart `file`) → use the returned `markdown` (GitLab renders images and plays videos inline). Body = `promoteSectionHeadings(description)` (import from `@/lib/github`), evidence under an existing Evidence heading or a new `## Evidence` (reuse `hasEvidenceHeading`), captions above each image, then `withGithubDetails(body, details)`, then `withBriefAttribution`.
- [ ] **Step 6: Fields.** labels resolved with `resolveName` against project labels (unknown ones skipped, never created); `priority` → `matchPriorityLabel(priority, labels)`; `state`: a status label is added, `"Closed"` closes after create (`PUT state_event=close`); `assignee` → member id by name or username; extraFields map milestone title → `milestone_id`, plus `due_date`, `weight`, `confidential`, `issue_type`. `POST /projects/:id/issues`. `comment` → `POST /projects/:id/issues/:iid/notes`. Return `{ id: String(issue.id), identifier: issue.references.full, url: issue.web_url, title }`.
- [ ] **Step 7: Update/get.** Identifier parse: `/^(.+)#(\d+)$/` → project path (URL-encoded) + iid. `updateIssue`: title; labels via `add_labels`; status label: `add_labels` it and `remove_labels` other labels with the same `scope::` prefix; `"Closed"`/`"Open"` → `state_event` close/reopen; priority swaps priority labels; assignee; extraFields. Unknown values return `{ ok:false, error: "Unknown state X. Valid: ..." }`. `getIssue` returns `{ title, state, labels, assignees, milestone, url }`.
- [ ] **Step 8: Search + live.** `searchIssues`: `GET /issues?scope=all&search=<q>&per_page=<limit>&order_by=updated_at` → results with `target` = project path from `references.full`, `priority` derived by checking `matchPriorityLabel(p, issue.labels)` for each priority. `getLiveIssues`: group by project; `GET /projects/:path/issues?iids[]=..&per_page=100`; an iid missing from that answer is confirmed with `GET /projects/:path/issues/:iid` and only a 404 while `GET /projects/:path` is 200 counts as `gone`. `stateName`: closed → `"Closed"`, else the status label's value after `::`, else `"Open"`; colors like GitHub (open active, closed done).
- [ ] **Step 9: Groups.** `listGitlabGroups(tok)`: `GET /groups?min_access_level=10&top_level_only=true&per_page=100` → `{ id: String(g.id), name: g.full_name, avatarUrl: g.avatar_url }`.
- [ ] **Step 10: Tests** (`gitlab.test.ts`, fetch stubbed, assert request URLs and bodies):
  - files with uploads: two uploads then one create; body contains both returned `markdown` strings under `## Evidence`, a `<details>` with the section title, and ends with the attribution.
  - unknown label skipped, priority label adopted (`priority::high` present, priority `high`).
  - `state: "Closed"` creates then closes.
  - update with `workflow::In review` removes `workflow::Doing`.
  - getLiveIssues: one found, one confirmed gone, one in an unreachable project NOT gone.
  - identifier parse of `a/b/c#12`.
- [ ] **Step 11:** e2e with `LIVE_GITLAB_TOKEN` (`api` scope). Delete = `DELETE /projects/:id/issues/:iid` (needs Owner; if 403, close it instead).
- [ ] **Step 12:** PASS. Commit `feat(web): file issues to GitLab`.

### Task 8: Asana adapter (new)

**Files:** Create `web/lib/asana.ts`, `asana-html.ts`, `asana.test.ts`, `asana-html.test.ts`, `asana.e2e.test.ts`.

API base `https://app.asana.com/api/1.0`, `Authorization: Bearer`, bodies `{ data: ... }`, errors `{ errors: [{ message }] }`, pagination `next_page.offset` (follow up to 3 pages).

- [ ] **Step 1: asana-html.ts.** `export function asanaHtml(md: string): string` returns `<body>...</body>` using ONLY Asana's rich-text tags: `body h1 h2 strong em u s code pre ol ul li a blockquote hr img`. Rules: `#`/`##` → `h1`/`h2`, `###`+ and whole-line `**Label**` → `h2`; paragraphs are text separated by `\n` (no `<p>`); fenced code → `<pre>`; lists; `[t](url)` → `<a href="url">t</a>` (http/https only); tables → `<pre>` of the raw table text; escape `& < >`. Tests: an allowlist test that parses every `<tag` in the output of a kitchen-sink markdown and asserts membership; heading, list, code, link, table cases.
- [ ] **Step 2: Targets.** `targetNoun: "project"`. `listTargets`: `GET /projects?workspace=<gid>&archived=false&limit=100&opt_fields=name,notes,team.name` → `name` = `${team} / ${name}` when a team exists, `description` = notes truncated to 200 chars.
- [ ] **Step 3: Capabilities.** `{ ...NO_CAPABILITIES, states: true, priority: true, labels: true, customFields: true, comments: true, nativeAttachments: true }`. `bodyGuidance`: "Asana notes support headings, bold, italics, lists, links and code blocks."
- [ ] **Step 4: Details.** `states` = section names (`GET /projects/:gid/sections`); `labels` = workspace tags (`GET /workspaces/:w/tags?limit=100`); `members` = `GET /users?workspace=:w&limit=100&opt_fields=name,email` names; `customFields` from `GET /projects/:gid/custom_field_settings?opt_fields=custom_field.gid,custom_field.name,custom_field.resource_subtype,custom_field.enum_options.name,custom_field.enum_options.enabled` → `{ id: gid, name, type: resource_subtype, allowedValues: enabled enum option names }`.
- [ ] **Step 5: File.** Resolve: section by `state` (resolveName); assignee gid by name or email; tag gids by name (existing only); priority → the enum custom field whose name matches `/priority/i`, option matched by `PRIORITY_ALIASES`-style names (reuse `matchPriorityLabel(priority, optionNames)`); extraFields keyed by field gid or exact name → enum option gid / number / text / `{ date }`. Create `POST /tasks` with `name`, `html_notes: asanaHtml(body)`, `memberships: [{ project, section }]` when a section resolved else `projects: [project]`, `assignee`, `tags`, `custom_fields`. Upload evidence `POST /attachments` multipart (`parent`, `resource_subtype=asana`, `file`). Then embed images: `PUT /tasks/:gid` with `html_notes` that adds `<img data-asana-gid="<attachment gid>"/>` (caption line above each) under an `Evidence` h2; if that PUT fails, keep the first notes (attachments still show on the task). `details` → `technical-logs.md` attachment. `comment` → `POST /tasks/:gid/stories { text }`. Return `{ id: gid, identifier: gid, url: permalink_url, title }`.
- [ ] **Step 6: Update/get.** `updateIssue`: `PUT /tasks/:gid` (name, assignee, custom_fields incl. priority); `state` → section in the task's first project via `POST /sections/:sgid/addTask { task }`, or `completed: true` when the state matches `/^(done|complete|completed|closed)$/i` and no section has that name; labels → `POST /tasks/:gid/addTag` per tag. `getIssue`: `GET /tasks/:gid?opt_fields=name,completed,assignee.name,memberships.section.name,memberships.project.name,tags.name,custom_fields.name,custom_fields.display_value,permalink_url`.
- [ ] **Step 7: Search + live.** `searchIssues`: `GET /workspaces/:w/typeahead?resource_type=task&query=<q>&count=<limit>&opt_fields=name,permalink_url,completed,assignee.name,memberships.project.name,memberships.section.name,tags.name` (works on every Asana tier, unlike task search). `getLiveIssues`: `POST /batch` with up to 10 `{ method:"get", relative_path:"/tasks/<gid>", options:{ fields:[...] } }` per call; `status_code 404` → gone; stateName `Completed` when completed, else the first membership's section name, else `Open`; color done when completed or the section matches `/done|complete|closed|shipped/i`, active when `/progress|doing|review|working/i`, else neutral; assignee `{ name, avatarUrl: photo.image_60x60 }`.
- [ ] **Step 8: Workspaces.** `listAsanaWorkspaces(token)`: `GET /workspaces?opt_fields=name`.
- [ ] **Step 9: Tests:** create with section membership; priority enum resolved; evidence uploaded then notes updated with `data-asana-gid`; notes-update failure keeps the task; logs uploaded as technical-logs.md; batch live read with a 404 → gone; typeahead search mapping.
- [ ] **Step 10:** e2e with `LIVE_ASANA_TOKEN` (+ optional `LIVE_ASANA_WORKSPACE`). Delete = `DELETE /tasks/:gid`.
- [ ] **Step 11:** PASS. Commit `feat(web): file tasks to Asana`.

### Task 9: Monday adapter (new)

**Files:** Create `web/lib/monday.ts`, `monday.test.ts`, `monday.e2e.test.ts`.

GraphQL `POST https://api.monday.com/v2`, headers `Authorization: <token>` (no Bearer), `API-Version: 2025-04`, `Content-Type: application/json`. Errors: `errors[]` or `error_message`; throw with the message. Files: `POST https://api.monday.com/v2/file` multipart with `query` and `variables[file]`.

- [ ] **Step 1: Account.** `listMondayAccount(tok)`: `query { me { account { id name slug } } }` → `[{ id, name }]`. The adapter memoizes `slug` for URLs (`https://${slug}.monday.com/boards/${board}/pulses/${item}`; prefer an item's own `url` field when returned).
- [ ] **Step 2: Targets.** `targetNoun: "board"`. `listTargets`: `boards(limit: 100, state: active, order_by: used_at) { id name description type workspace { name } }`, keep `type == "board"`, name `${workspace} / ${name}` when the workspace has a name.
- [ ] **Step 3: Capabilities.** `{ ...NO_CAPABILITIES, projects: true, states: true, priority: true, customFields: true, comments: true, nativeAttachments: true }`. `bodyGuidance`: "The description is posted as the item's first update."
- [ ] **Step 4: Columns.** `getTargetDetails(boardId)`: `boards(ids: [$id]) { id name description columns { id title type settings_str } groups { id title } subscribers { id name } }`. Pure helpers (exported, unit-tested): `statusColumn(cols)` = first `status` column titled `/status/i`, else first `status` column not titled `/priority/i`; `priorityColumn(cols)` = first `status` column titled `/priority/i`; `peopleColumn(cols)` = first `people` column; `columnLabels(col)` parses `settings_str` (`status`: `labels` object values; `dropdown`: `labels[].name`). `states` = status labels; `projects` = groups `{ id, name: title }`; `members` = subscriber names; `customFields` = remaining columns except `name`, the three above, `subitems`, `formula`, `mirror`, `auto_number`, `creation_log`, `last_updated` → `{ id, name: title, type, allowedValues }`.
- [ ] **Step 5: File.** column_values: status `{ label }`, priority `{ label }` (matched with `matchPriorityLabel`), people `{ personsAndTeams: [{ id, kind: "person" }] }` (user id from `users(limit: 200) { id name email }` matched by name/email), extraFields by column id or exact title (status/dropdown `{ labels: [x] }`, date `{ date }`, text/long_text/numbers as string). `create_item(board_id, group_id, item_name, column_values, create_labels_if_missing: false) { id url }` with `group_id` from `project` (resolveName over group titles). Body: `create_update(item_id, body: mdToHtml(body)) { id }`. Evidence and `technical-logs.md` go on that update via `add_file_to_update(update_id, file)`. `comment` → second `create_update`. Identifier = item id.
- [ ] **Step 6: Update/get.** Board id via `items(ids: [$id]) { board { id } }`. `updateIssue`: `change_multiple_column_values(item_id, board_id, column_values)` (title via `{"name": "..."}`), `project` → `move_item_to_group`. `getIssue`: `items(ids: [$id]) { id name url state board { id name } group { title } column_values { id type text column { title } } }`.
- [ ] **Step 7: Search + live.** `searchIssues`: over the 5 most-used boards, `items_page(limit: 5, query_params: { rules: [{ column_id: "name", compare_value: [$q], operator: contains_text }] })`; best effort. `getLiveIssues`: `items(ids: [...], limit: 100) { id name url state created_at column_values { id type text column { title } } }`; `state == "deleted"` → gone; `archived` → stateName `Archived`, color done; ids missing from the answer are NOT gone; stateName from the status column text (same `statusColumn` rule on titles); color done for `/done|complete/i`, active for `/working|progress|review|stuck/i`, else neutral; assignee from the people column text (first name before a comma).
- [ ] **Step 8: Tests:** status/priority/people column picking from a realistic `settings_str`; create mutation variables; update posted as HTML; files sent to `/v2/file` with `variables[file]`; deleted item → gone, missing → not gone.
- [ ] **Step 9:** e2e with `LIVE_MONDAY_TOKEN`. Delete = `delete_item(item_id)`.
- [ ] **Step 10:** PASS. Commit `feat(web): file items to Monday`.

### Task 10: Workspace pick

**Files:** Create `web/lib/workspaces.ts`, `workspaces.test.ts`, `web/app/api/org/workspace/route.ts`, `web/components/WorkspacePicker.tsx`. Modify `web/lib/org-server.ts`, `web/app/api/org/github/route.ts`, `web/components/TicketPreferences.tsx`, `web/components/SettingsView.tsx`, `web/app/(main)/connections/page.tsx`.

- [ ] **Step 1: workspaces.ts.**

```ts
export const WORKSPACE_NOUN: Record<ProviderKey, string> = {
  linear: "workspace", jira: "site", github: "organization", gitlab: "group",
  azure: "organization", clickup: "workspace", notion: "workspace",
  trello: "workspace", asana: "workspace", monday: "account",
};
/** Every workspace this user's token for `provider` can see. [] when not connected. */
export async function listWorkspaces(userId: string, provider: ProviderKey): Promise<Workspace[]>;
/** The picked workspace; a provider with exactly one is picked implicitly. */
export async function getPickedWorkspace(userId: string, provider: ProviderKey): Promise<Workspace | null>;
/** Validated against listWorkspaces; clears the org_members cache row. */
export async function setPickedWorkspace(userId: string, provider: ProviderKey, id: string): Promise<{ ok: true } | { ok: false; error: string }>;
/** Workspaces to offer when the user has several and has not picked. */
export async function workspacesToPick(userId: string, provider: ProviderKey): Promise<Workspace[]>;
```

  Storage: owned providers `account_meta.workspaceId/workspaceName` (`setConnectionMeta`); `github` reads/writes the existing `privateMetadata.githubOrg` (login as id and name); `gitlab` writes `privateMetadata.trackerWorkspace.gitlab = { id, name }`; `notion` and `monday` have exactly one (never stored). Listing calls the provider's list function with the user's token (`getConnection` for owned, Clerk token for Clerk ones; Azure passes `Bearer ${accessToken}`). `listWorkspaces` memoizes per (user, provider) for 5 minutes like `githubOrgsToPick`.
- [ ] **Step 2: Tests** (`workspaces.test.ts`, mock `@/lib/connections`, `@clerk/nextjs/server`, the list functions): one workspace → implicit pick, nothing stored; several → null until set; set rejects an id not in the list; set stores to `account_meta` for clickup and to privateMetadata for gitlab; github reads `githubOrg`.
- [ ] **Step 3: org-server.ts.** Keep Linear and Jira branches. Replace the GitHub-only branch with a loop over the remaining connected providers in registry order: `const ws = await getPickedWorkspace(userId, p); if (ws) return { key: orgKey(p, ws.id), name: ws.name, provider: p }`. `githubOrgsToPick`/`getPickedGithubOrg`/`setPickedGithubOrg` become thin wrappers over `workspaces.ts` (keep exports so callers compile). `resolveFromTrackers` gets the connected list from the async registry function (Task 11).
- [ ] **Step 4: route.** `app/api/org/workspace/route.ts`: `GET ?provider=` → `{ workspaces, picked }`; `POST { provider, id }` → `setPickedWorkspace`; Clerk `auth()`; 400 on unknown provider. `api/org/github/route.ts` delegates (`provider: "github"`, `id: body.login`).
- [ ] **Step 5: UI.** `WorkspacePicker({ provider, noun, workspaces })` = today's `GithubOrgPicker` generalized (eyebrow `Your ${providerName} ${noun}`, posts to `/api/org/workspace`, `router.refresh()` after). `GithubOrgPicker` is deleted; `SettingsView` takes `workspaces: { provider, noun, list }` instead of `githubOrgs`; the Team row summary reads `Pick your ${name} ${noun}`. `connections/page.tsx` computes `workspacesToPick(userId, connected[0])` when there is no org.
- [ ] **Step 6:** `npx vitest run lib/workspaces.test.ts lib/org*.test.ts components/TicketPreferences*.test.tsx` PASS (update `TicketPreferences.confirm.test.tsx` props if needed). Commit `feat(web): pick your workspace on any tracker`.

### Task 11: Registry and filing wiring

**Files:** Modify `web/lib/trackers/registry.ts`, `registry.test.ts`, `web/lib/briefs-server.ts`, `web/lib/tracker-health.ts`, `web/lib/ticket-sync.ts`, `ticket-sync.test.ts`, `web/lib/agent/process-brief.ts`, `web/app/api/me/route.ts`.

- [ ] **Step 1: registry entries** (order = tie-break): linear, jira, github, gitlab (`auth:"clerk"`, `getGitlabToken`), azure, clickup, notion (`auth:"clerk"`), trello, asana, monday. `ProviderDef` gains `auth: "clerk" | "owned"`. Owned resolves:
  - azure: `getConnection` + picked workspace (`meta.workspaceId`) → `makeAzureTracker({ org, authorization: \`Bearer ${c.accessToken}\` })`; null without a workspace.
  - clickup: `makeClickUpTracker({ token, teamId: meta.workspaceId })`.
  - trello: `makeTrelloTracker({ key: process.env.TRELLO_API_KEY, token })`, null without the key.
  - asana: needs `meta.workspaceId` → `makeAsanaTracker({ token, workspaceGid })`.
  - monday: `makeMondayTracker({ token })`.
- [ ] **Step 2: connected list.** `connectedProviders(user)` keeps its sync signature for Clerk providers (filters `auth === "clerk"`). Add `export async function connectedTrackers(userId: string, user?: ...): Promise<ProviderKey[]>` = Clerk ones from the user + `listConnectedProviders(userId)`, in registry order. `briefs-server.getTrackerContext` and `org-server` switch to it. `looksConnected` adds owned rows. `CLERK_PROVIDERS = PROVIDERS.filter(p => p.auth === "clerk")`, `OWNED_PROVIDER_DEFS` likewise.
- [ ] **Step 3: registry tests**: owned provider resolves from a mocked `getConnection`; azure without a workspace resolves null; `connectedTrackers` merges and orders; `resolveTracker(user, "trello")` pinned only tries trello.
- [ ] **Step 4: ticket-sync.** `HOST_PATTERNS` add `["gitlab", /(^|\.)gitlab\.com$/]`, `["azure", /(^|\.)dev\.azure\.com$|\.visualstudio\.com$/]`, `["clickup", /(^|\.)clickup\.com$/]`, `["notion", /(^|\.)notion\.(so|site)$/]`, `["trello", /(^|\.)trello\.com$/]`, `["asana", /(^|\.)asana\.com$/]`, `["monday", /(^|\.)monday\.com$/]`. `shortIdentifier`: gitlab uses the github rule; notion and asana return `""` (no human key), monday returns `#${id}`. Find every caller of `shortIdentifier` and make an empty string render nothing (no empty chip). Tests for each host and short form.
- [ ] **Step 5: agent help.** In `process-brief.ts`: add `gitlab`, `asana`, `monday` to `CUSTOM_FIELD_HELP` (gitlab: `{"milestone": "<title>", "due_date": "2026-07-01", "weight": 3, "confidential": true, "issue_type": "incident"}`; asana: custom fields by gid or exact name, enum by option name; monday: columns by id or exact title, status/dropdown by label), `STATE_HELP` (gitlab: "\"Open\", \"Closed\", or a status label like \"workflow::In review\" from the target's state list."; asana: "The section to put the task in, from the target's state list. \"Done\" completes it when there is no such section."; monday: "A label of the board's Status column."), `PRIORITY_HELP` (gitlab like github's label wording; asana: "applied to the project's Priority field when it has one, skipped otherwise"; monday: "applied to the board's Priority column when it has one"), `PROJECT_HELP` (monday: "The group on the board (e.g. \"Bugs\") to put the item in."). Fix `search_issues`'s description: replace `${noun === "team" ? "Linear" : "Jira"}` with the provider's display name (`providerName(tracker.kind)` from the registry).
- [ ] **Step 6: /api/me** returns `{ ok, tracker, trackerName }` (`trackerName = tracker ? providerName(tracker) : null`).
- [ ] **Step 7:** `npx tsc --noEmit` clean; `npx vitest run` all PASS. Commit `feat(web): the registry files to all ten trackers`.

### Task 12: Owned OAuth routes

**Files:** Create `web/app/api/connect/[provider]/start/route.ts`, `callback/route.ts`, `disconnect/route.ts`, `web/app/api/me/connections/route.ts`, `web/app/api/connect/connect.test.ts`. Modify `web/proxy.ts` only if `/api/connect/(.*)` needs to be reachable signed-out (it must NOT: all four routes require a Clerk session).

- [ ] **Step 1:** Port the three routes and `/api/me/connections` from OLD (`git show "OLD:web/app/api/connect/[provider]/start/route.ts"` etc.). `params` is a Promise.
- [ ] **Step 2: callback changes.** After the token exchange, resolve the account label and workspaces per provider with the list functions (azure → `listAzureOrgs(\`Bearer ${token}\`)`, clickup → `listClickUpWorkspaces`, trello → `listTrelloWorkspaces`, asana → `listAsanaWorkspaces`, monday → `listMondayAccount`). Exactly one → store `workspaceId/workspaceName`; several → store none and redirect to `/connections?pick=<provider>`; zero for azure → redirect with `?error=` "No Azure DevOps organization on this account". Monday's token response has no expiry; Asana's has `expires_in` + `refresh_token`.
- [ ] **Step 3: one tracker at a time.** The callback deletes other owned rows (`deleteOtherConnections`) AND removes the user's Clerk external accounts for tracker providers (`client.users.deleteUserExternalAccount({ userId, externalAccountId })` for each account matching a `CLERK_PROVIDERS` `clerkMatch`), and clears the `org_members` row.
- [ ] **Step 4: `/api/me/connections`** → `{ owned: Array<{ provider, label }>, configured: Record<OwnedProvider, boolean> }`.
- [ ] **Step 5: Tests** (`connect.test.ts`): start redirects to the provider's authorize URL with `client_id`, `redirect_uri`, signed `state`; callback with a bad state → 400; callback exchanges the code (fetch stubbed) and saves the connection with the single workspace; several workspaces → redirect contains `pick=`; Trello relay page posts the fragment token.
- [ ] **Step 6:** PASS. Commit `feat(web): connect Azure DevOps, ClickUp, Trello, Asana and Monday`.

### Task 13: Settings and onboarding UI

**Files:** Modify `web/components/TrackerLogo.tsx`, `useTrackerConnect.ts`, `Integrations.tsx`, `TrackerPicker.tsx`, `Onboarding.tsx`, `web/lib/onboarding-options.ts` if it lists trackers.

- [ ] **Step 1: Logos.** Add `GitlabLogo, AzureDevopsLogo, ClickUpLogo, NotionLogo, TrelloLogo, AsanaLogo, MondayLogo` as inline SVG in brand colors. Port the four OLD has (`git show OLD:web/components/TrackerLogo.tsx`); take GitLab and Asana paths from simple-icons (`curl -s https://cdn.jsdelivr.net/npm/simple-icons@13.21.0/icons/gitlab.svg`, `.../asana.svg`) with colors `#FC6D26`, `#F06A6A`; Monday has no simple-icons entry: draw its three rounded dots (red `#FF3D57`, yellow `#FFCB00`, green `#00D647`) in a 24x24 viewBox. `TrackerLogo` maps every key.
- [ ] **Step 2: hook.** `TrackerDef` gains `auth: "clerk" | "owned"`; captions: GitLab "File issues to a project.", Azure DevOps "File work items to a project.", ClickUp "File tasks to a list.", Notion "File pages to a database.", Trello "File cards to a board.", Asana "File tasks to a project.", Monday "File items to a board.". The hook fetches `/api/me/connections` once (state `owned`, `configured`); `isConnected(t)` for owned = present in `owned`; `connect(t)` for owned = `window.location.href = /api/connect/${key}/start?returnTo=${redirectPath}` after disconnecting the other trackers; `disconnect(t)` for owned = `POST /api/connect/${key}/disconnect`; `disconnectOtherTrackers` also disconnects owned rows. Port the owned branches from OLD's `useTrackerConnect.ts` diff.
- [ ] **Step 3: picker.** `TrackerPicker` options list all ten; an owned provider with `configured[key] === false` shows its card with Connect disabled and a muted "Not available yet" message (the `messageFor` path). Back from `?pick=<provider>`, Settings opens the Team row.
- [ ] **Step 4: tests.** Extend the existing TrackerPicker test (or add `TrackerPicker.test.tsx`, jsdom) for: ten options, disabled unconfigured option.
- [ ] **Step 5:** tsc, eslint on changed files, vitest PASS. Commit `feat(web): Settings offers all ten trackers`.

### Task 14: Copy, extension, docs, setup script

**Files:** Modify `web/lib/guide/lessons.ts`, `web/app/privacy/page.tsx`, `web/.env.local.example`, `extension/popup.js`. Create `web/TRACKERS.md`, `web/scripts/setup-trackers.mjs`.

- [ ] **Step 1:** Guide lesson 2 and the privacy policy name the ten trackers ("Linear, Jira, GitHub, GitLab, Azure DevOps, ClickUp, Notion, Trello, Asana or Monday").
- [ ] **Step 2:** `popup.js`: `TRACKER_NAMES` gains the seven; `/api/me`'s `trackerName` is cached alongside `tracker` in `bcTrackerCache` and preferred by `trackerName()`.
- [ ] **Step 3:** `.env.local.example`: `CONNECTIONS_KEY`, the five client id/secret pairs, `TRELLO_API_KEY`, the `NEXT_PUBLIC_*_CLERK_STRATEGY` overrides for notion/gitlab, and the `LIVE_*` test vars, each with a one-line comment.
- [ ] **Step 4:** `TRACKERS.md`: per provider, where to register the app, redirect URI (`https://cloud.get-brief.app/api/connect/<p>/callback`; Clerk ones use `https://clerk.get-brief.app/v1/oauth_callback`), scopes, env names, and how to make a personal token for the e2e test.
- [ ] **Step 5:** `setup-trackers.mjs`: modeled on OLD's `scripts/setup-github-connector.mjs`; prompts for Notion and GitLab client id/secret per instance and runs `clerk config patch --app app_3EuwmRO8NeigvagtwXW31VrAd0O --instance <id> --file <tmp> --yes --mode agent` with `{ connection_oauth_notion: { enabled: true, authenticatable: false, client_id, client_secret } }` (same for gitlab); then prints the `fly secrets set` line for the owned providers with placeholders. Secrets go via a 0600 temp file, deleted in `finally`.
- [ ] **Step 6:** Commit `docs: set up the seven new trackers`.

### Task 15: Clerk, database, verification

- [ ] **Step 1: Clerk dev.** `clerk config patch --app app_3EuwmRO8NeigvagtwXW31VrAd0O --instance ins_3EuwmRFmoRNzasNtxENdb4uA3W2 --json '{"connection_oauth_gitlab":{"enabled":true,"authenticatable":false}}' --yes --mode agent`; Notion on dev is already enabled connect-only (verify with `clerk config pull`). Dry-run the prod payloads with dummy credentials (`--dry-run`) to prove the setup script's shape.
- [ ] **Step 2: migration.** Apply `0014_tracker_connections.sql` to the shared DB through the IPv4 pooler (`aws-0-eu-west-1.pooler.supabase.com:5432`, user `postgres.<project-ref>`, password from `SUPABASE_DB_URL`, `ssl: { rejectUnauthorized: false }`), with a scratchpad `.cjs` using `pg` from the worktree's `node_modules`. Verify with `select count(*) from tracker_connections`.
- [ ] **Step 3: gates.** From `web/`: `npx tsc --noEmit` (0 errors), `npx eslint` on changed files, `npx vitest run` (all pass), `npx next build --webpack` (green).
- [ ] **Step 4: e2e.** Run each `*.e2e.test.ts` whose env is set; report which ran.
- [ ] **Step 5: UI.** Dev server (webpack) in the preview browser through a temporary `/dev/trackers` route (public in `proxy.ts` while it exists) that renders `TrackerPicker` with all ten options plus a `WorkspacePicker`; screenshot; delete the route and its proxy entry before the final commit.
- [ ] **Step 6:** Commit any fixes; push with `GH_TOKEN=$(gh auth token -u razi2001)`; open the PR.
