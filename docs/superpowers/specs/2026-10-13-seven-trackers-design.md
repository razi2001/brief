# Seven more trackers: Azure DevOps, ClickUp, Trello, Notion, GitLab, Asana, Monday

Approved 2026-10-13. Brief files into Linear, Jira and GitHub today. This adds
seven trackers, each ticket shaped to that tracker's own grain.

## Approach

Port and extend. The unmerged branch `claude/ticket-integrations-structure-488686`
(commit c42578f and follow-ups, 2026-09-12) holds working adapters for Azure
DevOps, ClickUp, Trello and Notion plus a Brief-owned OAuth vault. Main's
`Tracker` interface is nearly identical to that branch's; what main gained since
is the technical logs (`IssueInput.details`), org identity, and a redesigned UI.
The four adapters are ported onto current main and adapted; GitLab, Asana and
Monday are written fresh on the same seams.

Rejected: a fresh rewrite (redoes solved problems such as ADO's Repro Steps and
ClickUp's dropdown option ids); the providers' own MCP servers (Clerk cannot
vend MCP-audience tokens, and each shapes tickets differently).

## 1. Auth: two paths, one registry

- **Clerk connected accounts:** Linear, Jira and GitHub only, as before.
- **GitLab and Notion are Brief-held, not Clerk.** Clerk has built-in
  connections for both, but production's Clerk plan refuses a fourth social
  connection: a `clerk config patch` dry-run on prod answered
  `402 unsupported_subscription_plan_features: app:unlimited_social`, and prod
  already has Linear, Atlassian and GitHub. Brief-owned OAuth works on any
  plan, so they take that path instead of a plan upgrade.
- Clerk CUSTOM connectors were considered for the OAuth 2.0 providers (Clerk
  would store and refresh their tokens) and rejected: they are a paid-plan
  feature on a production instance, which is why production GitHub already
  rides the built-in connection. Brief-owned OAuth works on any plan.
- **Brief-owned OAuth:** GitLab (gitlab.com app, scopes `api read_user`, PKCE,
  refresh tokens rotate and are revoked on use), Azure DevOps (Entra app, ADO
  resource scope `499b84ac-1321-427f-aa17-267ca6975798/.default
  offline_access`), ClickUp, Notion (public integration; the token exchange
  takes HTTP Basic and a JSON body, and its reply names the workspace), Trello
  (token flow, not OAuth 2.0: token comes back in the URL fragment, a relay
  page posts it to the server), Asana, Monday.
  - Table `tracker_connections` (migration 0014): one row per (user, provider),
    tokens AES-256-GCM encrypted under `CONNECTIONS_KEY` (`lib/crypto.ts`),
    `account_meta` jsonb for resolved handles.
  - OAuth `state` is HMAC-signed (user id, provider, expiry) so a crafted
    callback cannot attach someone's tracker account to another Brief user.
  - Expiring tokens (GitLab, Azure, Asana, Notion when it sends a refresh
    token) are refreshed ahead of expiry; a failed refresh reads as a stale
    connection ("reconnect"). Concurrent refreshes in one process share one
    request, and a refresh GitLab refuses because another machine already
    rotated the token picks up the token that machine stored.
  - Routes: `/api/connect/[provider]/start`, `/callback`, `/disconnect`.
- The registry entry gains `auth: "clerk" | "owned"`. `connectedProviders`
  becomes Clerk external accounts plus one `tracker_connections` read.
- Brief still files into ONE tracker: connecting one disconnects the other.
- A provider whose app credentials are not set on the deployment reports
  `configured: false`; its card says so and Connect is disabled.

## 2. Workspace pick

Each provider lists the workspaces the token can see: Azure organizations,
ClickUp workspaces, Trello workspaces, Asana workspaces, GitLab groups, GitHub
orgs (existing). Notion (the workspace the integration was installed in) and
Monday (the account) always have exactly one.

- One workspace: picked automatically. Several: the tracker card on Settings
  shows a Workspace select (the existing `GithubOrgPicker`, made generic).
- The pick is the org identity (podium, team ticket rules, ROI), keyed
  `orgKey(provider, workspaceId)`.
- For Azure DevOps, ClickUp and Asana the pick also scopes filing (Azure's API
  host is per organization; ClickUp and Asana targets live inside a workspace).
- Stored next to its connection, so it dies with it: owned providers in
  `tracker_connections.account_meta.workspaceId/workspaceName`, GitHub in its
  legacy Clerk `privateMetadata.githubOrg`.

## 3. Ticket shape per tracker

| Tracker | Target the agent picks | Status | Priority | Evidence | Technical logs |
|---|---|---|---|---|---|
| Azure DevOps | project; work item type; area path as `project` | State | Microsoft.VSTS.Common.Priority 1-4 | attachments, images inline; Bug body in Repro Steps | HTML sections in the body |
| ClickUp | list | the list's statuses | native 1-4 | attachments | fenced code in `markdown_description` |
| Trello | board | the list (status = list) | an existing label matching the team's convention | attachments, first screenshot as cover | `technical-logs.md` attachment (16k description cap) |
| Notion | database (data source) | Status/Select property | Select property named like priority | images by `/api/evidence` URL | toggle blocks |
| GitLab | project | `workflow::`-style scoped labels; closed | priority labels by convention | project uploads, inline | `<details>` |
| Asana | project (in the workspace) | section | a "Priority" enum custom field when present | attachments | `technical-logs.md` attachment |
| Monday | board | the Status column | a Priority status column when present | files on the item's first update | `technical-logs.md` attachment |

Every adapter implements the full `Tracker` interface: `listTargets`,
`searchIssues`, `getTargetDetails`, `fileIssue`, `updateIssue`, `getIssue`,
`getLiveIssues` (status, title, assignee, and `gone` only for confirmed
deletions), `capabilities`, `targetNoun`, `bodyGuidance`.

## 4. UI and copy

- Settings tracker dropdown lists all ten with real logos (`TrackerLogo`).
- Onboarding uses the same list. Owned providers (GitLab and Notion included)
  connect by navigating to `/api/connect/<provider>/start`; Clerk providers keep
  `createExternalAccount`.
- Guide's tracker lesson and the privacy policy name all ten.
- `/api/me` returns `trackerName` beside `tracker`; the extension popup prefers
  it, so a future tracker needs no extension change. The popup's static name
  map also gains the seven (ships with the next extension bump).

## 5. Verification

- Unit tests per adapter replay recorded API envelopes (fetch stubbed).
- One `<provider>.live.test.ts` per tracker, skipped unless its token env var
  is set (`LIVE_AZURE_PAT` + `LIVE_AZURE_ORG`, `LIVE_CLICKUP_TOKEN`,
  `LIVE_TRELLO_KEY` + `LIVE_TRELLO_TOKEN`, `LIVE_NOTION_TOKEN`,
  `LIVE_GITLAB_TOKEN`, `LIVE_ASANA_TOKEN`, `LIVE_MONDAY_TOKEN`). Each lists
  targets, files a ticket with a screenshot and logs, reads it back, changes
  status, runs `getLiveIssues`, then deletes or archives the ticket.
- Azure PATs authenticate with Basic, OAuth tokens with Bearer: adapters take
  an auth header builder rather than a bare token.
- OAuth connect flows: unit tests (state signing, callback token exchange with
  fetch stubbed) plus `web/TRACKERS.md` listing each app registration (redirect
  URIs, scopes, env names).
- Gates: `tsc --noEmit`, eslint, vitest, `next build --webpack`.

## 6. Rollout

- Migration 0014 is additive; applied to the shared live DB only with the
  owner's OK.
- Fly secrets: `CONNECTIONS_KEY`, `GITLAB_CLIENT_ID/SECRET`,
  `AZURE_DEVOPS_CLIENT_ID/SECRET`, `CLICKUP_CLIENT_ID/SECRET`,
  `NOTION_CLIENT_ID/SECRET`, `TRELLO_API_KEY/SECRET`, `ASANA_CLIENT_ID/SECRET`,
  `MONDAY_CLIENT_ID/SECRET`. No Clerk change: it keeps Linear, Jira and GitHub.
- Safe to deploy before the apps exist: unconfigured trackers show as
  unavailable.
- One branch, one PR, commits in order: vault + registry + workspace pick;
  Notion, Azure DevOps, ClickUp, Trello; GitLab, Asana, Monday; UI, extension,
  copy.

## Out of scope

Self-hosted GitLab / Azure DevOps Server; filing into more than one tracker at
once; Notion's file-upload API (evidence by URL, as the ported adapter does).
