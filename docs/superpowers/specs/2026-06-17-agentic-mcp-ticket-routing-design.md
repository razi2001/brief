# Agentic, context-aware ticket routing — design

**Date:** 2026-06-17
**Status:** Draft for review
**Author:** Razi (+ Claude)

## 1. Goal

Make Brief Cloud's ticket-filing agent **decide autonomously where a ticket belongs and how to tag it** — picking the right team/project, applying the labels your team actually uses, and filling custom fields — by *understanding the bug* and *learning from your existing tickets*, with no rules or per-customer configuration.

Concretely, the agent should reason like a senior on-call engineer triaging an issue: read the failure, identify which team *owns* that surface (not just where it surfaced), and match the org's existing conventions for labels, custom fields, and priority. This generalizes to any org and team layout because the judgment comes from the model + live context, never a hardcoded mapping.

### Transport decision
- **Linear:** drive the official **Linear MCP server** (`https://mcp.linear.app/mcp`) via the OpenAI Responses API `mcp` tool. Verified feasible: Linear MCP accepts an existing Linear OAuth access token directly as `Authorization: Bearer` (no separate OAuth integration), and exposes the full read/write/search surface we need.
- **Jira:** keep a **direct-REST fallback adapter** (the current Jira client, extended). Verified necessary: Atlassian's official MCP rejects third-party OAuth tokens (no DCR; allowlisted clients only), has **no attachment-upload tool**, and gates non-interactive auth behind per-customer admin enablement — all non-starters for a multi-tenant product.

This "MCP where we can, fallback where we can't" split is the explicit architecture choice.

## 2. Non-goals

- **No duplicate detection / dedup.** The agent files a ticket; it does not search for and merge into existing ones.
- **No provider switch.** The agent stays on OpenAI (per decision). Linear tools are reached via OpenAI's remote-MCP support, not a different LLM.
- **No change to dashboard live-sync.** `getIssuesByIdentifiers` (Linear) and `getJiraIssues` (Jira) that power the dashboard's ticket-status refresh stay on direct API and are out of scope.
- **No migration of Jira to MCP.** Blocked upstream; revisit only if Atlassian opens third-party OAuth + attachments.
- **No new infra.** OpenAI makes the outbound MCP calls; our Fly.io backend needs no MCP client.

## 3. Architecture

A **single agent execution path on the OpenAI Responses API**, with a **provider-dependent tool set** and a **shared smart-triage system prompt**.

```
run-processing.ts
  ├─ prep (download evidence, transcribe, keyframes)  [unchanged]
  ├─ pick tracker (Linear preferred, else Jira)        [unchanged]
  ├─ Linear: pre-upload evidence → get assetUrls       [NEW placement]
  └─ processBrief(input, provider)
        └─ openai.responses.create({ model, input, tools, instructions })
              ├─ Linear → tools: [{ type:'mcp', server_url:'https://mcp.linear.app/mcp', ... }]
              └─ Jira   → tools: [ local function tools backed by Jira REST ]  ("the fallback")
```

The model gets the same instructions and the same conceptual tools (discover targets → search existing issues → file → verify) regardless of provider. Only the *implementation* of those tools differs.

### 3.1 Linear path (MCP)

OpenAI Responses API `mcp` tool, one per request:

```ts
{
  type: 'mcp',
  server_label: 'linear',
  server_url: 'https://mcp.linear.app/mcp',
  authorization: linearAccessToken,   // the per-user Clerk oauth_linear token
  require_approval: 'never',
  allowed_tools: [
    'list_teams', 'list_projects', 'list_issue_labels',
    'list_issue_statuses', 'list_users', 'list_issues',
    'get_issue', 'save_issue', 'create_attachment_from_upload',
  ],
}
```

- **Auth:** `authorization` carries the user's existing Clerk-vended Linear OAuth token, sent per request and discarded by OpenAI afterward. Requires `write`/`issues:create` scope (see §7).
- **Routing/tagging context:** `list_teams` (+ `get_team` for descriptions), `list_projects`, `list_issue_labels`, `list_issue_statuses`, `list_users` for the target surface; **`list_issues` is the precedent search** (filter/query by keywords) — it returns existing issues with their team, labels, assignee, state, priority, project, so the agent learns conventions by example.
- **Filing:** `save_issue` (create) with title/team/description/labels/assignee/priority/state/project; `get_issue` + `save_issue` (update) for verify-and-repair.
- **`require_approval: 'never'`** so OpenAI auto-loops the MCP calls within one response. `allowed_tools` is an explicit allowlist — a safety boundary against prompt-injected writes (see §7).

### 3.2 Jira path (fallback adapter)

The existing Jira REST client ([web/lib/jira.ts](web/lib/jira.ts)), exposed to the same Responses API loop as **local function tools** (type `function`, executed in-process), extended with:
- `search_issues` — backed by JQL text search (generalizes the existing `getJiraIssues` JQL read into a keyword/text search), returning enriched results (labels, priority, status, assignee, **custom fields**, key, url).
- Project **descriptions** added to the target list (the `/project/search` response already carries `description`).
- Custom fields already discovered via `createmeta` ([jira.ts:457-516](web/lib/jira.ts)) and writable via `extraFields` — unchanged, now informed by `search_issues` examples.
- Filing, attachments (REST multipart), comment, transition — unchanged.

"The fallback" = these local function tools. The agent can't tell the difference; only the transport does.

### 3.3 Evidence handling

OpenAI cannot transfer binary bytes through MCP. So:
- **Jira:** unchanged — backend POSTs multipart attachments to `/issue/{key}/attachments` after create.
- **Linear:** backend **pre-uploads** each evidence file via Linear's `fileUpload` GraphQL mutation (the kept `uploadAsset` helper), obtaining `assetUrl`s, *before* the agent runs. The evidence markdown block (inline `![](assetUrl)` for images, recording link) is passed into the agent's input context so the agent embeds it in the description it writes via `save_issue`. **Safety net:** after creation, the backend reads the issue and, if the recording `assetUrl` is missing from the description, patches it (guaranteeing the recording-attach contract the current code enforces). This keeps a *minimal* Linear file helper — the "fallback when we can't" applied to the byte transfer — while issue create/update/search/route all go through the official MCP.

## 4. New & changed capabilities

| Capability | Linear (MCP) | Jira (fallback) |
|---|---|---|
| Discover teams/projects **with descriptions** | `list_teams`/`get_team`, `list_projects` | `/project/search` (+ description) |
| **Search existing issues (precedent)** — NEW | `list_issues` (query) | `search_issues` (JQL) — NEW |
| Enriched results (team, labels, assignee, priority, status, custom fields, url) | from `list_issues` | from JQL `fields` |
| Create / update issue | `save_issue` | existing REST |
| Custom fields by example | Linear structured fields | `createmeta` schema + `extraFields` |
| Attachments | backend pre-upload + embed | REST multipart |
| Verify & repair | `get_issue` + `save_issue` | existing |

## 5. Smart-triage system prompt (rewrite)

Replace the current 49-line prompt ([web/lib/agent/system-prompt.ts](web/lib/agent/system-prompt.ts)) with instructions that direct autonomous triage:

1. **Understand the failure first** — reason from evidence (screenshots > narration > console errors) to *what actually broke and where it lives* (e.g. a UI symptom whose root cause is a backend 500 belongs to the backend owner, not the frontend team).
2. **Gather context before deciding** — list targets (read team/project descriptions), then search existing issues with keywords drawn from the failure (error text, endpoint, page, feature).
3. **Route by ownership + precedent** — pick the team/project whose description matches the failing surface; use where similar issues were filed to disambiguate overlapping teams. Fall back to pure semantics when there's no precedent.
4. **Tag & fill fields by the org's convention** — mirror the labels and custom-field values of comparable retrieved issues rather than inventing; pick the closest *existing* label.
5. **Calibrate priority to impact + precedent.**
6. **File, then verify-and-repair.** Keep the create-once guard and the read-back-and-fix loop.
7. Keep existing constraints: banned vocabulary (no "brief"/"recording"/"capture"), don't invent URLs/filenames, evidence is provided.

No dedup instructions.

## 6. Code changes

- **[web/lib/agent/process-brief.ts](web/lib/agent/process-brief.ts)** — migrate from `chat.completions` to `responses.create`. Branch tool set by `tracker.kind`: Linear → remote `mcp` tool; Jira → local function tools (port the current 5 tools + new `search_issues`). Keep the verify/repair loop and create-once guard adapted to the Responses item model (`mcp_call` / `function_call` outputs).
- **[web/lib/tracker.ts](web/lib/tracker.ts)** — add `searchIssues(query, opts)` to the interface and a `description?` field to `TrackerTarget`/`TargetDetails`. (Used by the Jira fallback; the Linear path uses MCP tools directly but the interface stays the source of truth for the fallback + dashboard.)
- **[web/lib/jira.ts](web/lib/jira.ts)** — implement `searchIssues` (JQL text search, enriched fields); add project descriptions. Keep everything else.
- **[web/lib/linear.ts](web/lib/linear.ts)** — **shrink** to: `getLinearToken` (auth), `uploadAsset`/`fileUpload` (evidence pre-upload + the description-patch safety net), and the dashboard `getIssuesByIdentifiers` read path. The issue create/update/list/route logic is **removed** (now served by the Linear MCP). `makeLinearTracker` is retired from the filing path.
- **[web/lib/agent/system-prompt.ts](web/lib/agent/system-prompt.ts)** — rewrite per §5.
- **[web/lib/agent/run-processing.ts](web/lib/agent/run-processing.ts)** — for Linear, pre-upload evidence and assemble the evidence-URL context block before calling `processBrief`; pass provider + token through.
- **[web/lib/agent/evidence.ts](web/lib/agent/evidence.ts)** / **context-block.ts** — feed evidence URLs (Linear) / manifest (Jira) into the prompt context.
- **Routing/gating call sites** ([/api/me](web/app/api/me/route.ts), [/api/briefs/[id]/process](web/app/api/briefs/[id]/process/route.ts)) — unchanged logic; still gate on a connected tracker.

## 7. Auth, multi-tenant & security

- **Linear token reuse:** the Clerk `oauth_linear` access token is passed as the MCP `authorization`. **Prerequisite:** the Clerk Linear OAuth connection must request `write` (or `issues:create`) scope; if it currently requests only `read`, users must reconnect once. **Action item before build:** verify the configured scope string and update if needed.
- **Token transit:** the per-user token transits OpenAI (which makes the outbound MCP call) and is discarded after the request. Never log request bodies. Scope the token per request only.
- **`require_approval: 'never'` + `allowed_tools`:** auto-approval is required for an unattended background job, so we constrain the MCP surface with an explicit `allowed_tools` allowlist (no destructive/admin tools) to bound what a prompt-injected instruction in the evidence could trigger.
- **Jira:** unchanged — Clerk `oauth_atlassian` token against `api.atlassian.com/ex/jira/{cloudId}`, with the existing basic-auth env fallback for testing.

## 8. Testing

- **Characterization tests for the Jira fallback** before/after refactor (no adapter tests exist today): `search_issues` JQL building + result enrichment; existing `markdownToAdf`/`pickTransition`/`resolveName` stay green.
- **Linear MCP path:** unit-test the request assembly (correct `server_url`, `allowed_tools`, token wiring, evidence-URL context block) with a mocked `responses.create`; the verify/repair loop logic with simulated `mcp_call` outputs. Live smoke test against a real Linear workspace behind a flag.
- **Prompt routing:** a small fixture set (briefs with known-correct teams/labels across distinct org layouts) run against the agent to sanity-check routing quality and guard regressions.

## 9. Risks & mitigations

- **Linear OAuth scope too narrow** → writes silently fail. *Mitigation:* verify/expand scope (§7) before build; surface a clear error if a write is rejected for auth.
- **OpenAI can't PUT bytes** → handled by backend pre-upload + description-patch safety net (§3.3).
- **Loss of fine-grained loop control on the remote-MCP path** (OpenAI auto-loops) vs today's manual loop → keep the create-once guarantee and recording-embed via the backend safety net rather than mid-loop interception.
- **Linear MCP rate limits / SSE deprecation** → target `/mcp` (Streamable HTTP, not the deprecated `/sse`); handle 429s defensively.
- **Behavior drift in the Jira refactor** → characterization tests (§8).
- **Two execution branches** (MCP vs function tools) increase surface area → mitigated by sharing the prompt, the input assembly, and the verify/repair structure; only the tool list differs.

## 10. Open questions

- Exact Linear MCP tool parameter names for `list_issues` filtering (query vs structured filter) — confirm against the live tool schema during implementation.
- Whether `list_teams` returns team descriptions inline or requires `get_team` per team (affects how many discovery calls the agent makes).
- Final `allowed_tools` list — start minimal (the set in §3.1) and widen only if the agent needs more.
- **Model compatibility:** confirm the configured `AGENT_MODEL` supports remote-MCP tools *and* image input together on the Responses API; pick a known-good model id if the current default doesn't qualify.
