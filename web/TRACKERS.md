# Trackers: app registration

Brief files into ten trackers. Each needs an OAuth app on the provider's side.

| Tracker | Token held by | Prod redirect URI | Env |
|---|---|---|---|
| Linear, Jira, GitHub | Clerk | `https://clerk.get-brief.app/v1/oauth_callback` | none (live already) |
| GitLab | Brief | `https://cloud.get-brief.app/api/connect/gitlab/callback` | `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET` |
| Azure DevOps | Brief | `https://cloud.get-brief.app/api/connect/azure/callback` | `AZURE_DEVOPS_CLIENT_ID`, `AZURE_DEVOPS_CLIENT_SECRET` |
| ClickUp | Brief | `https://cloud.get-brief.app/api/connect/clickup/callback` | `CLICKUP_CLIENT_ID`, `CLICKUP_CLIENT_SECRET` |
| Notion | Brief | `https://cloud.get-brief.app/api/connect/notion/callback` | `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` |
| Trello | Brief | allowed origin `https://cloud.get-brief.app` | `TRELLO_API_KEY` |
| Asana | Brief | `https://cloud.get-brief.app/api/connect/asana/callback` | `ASANA_CLIENT_ID`, `ASANA_CLIENT_SECRET`, optional `ASANA_SCOPES` |
| Monday | Brief | `https://cloud.get-brief.app/api/connect/monday/callback` | `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET` |

- **Clerk-held**: Clerk runs the OAuth flow and stores the token (`lib/clerk-strategies.ts`).
- **Brief-held**: routes `/api/connect/<provider>/{start,callback,disconnect}`, tokens AES-256-GCM encrypted in `tracker_connections` under `CONNECTIONS_KEY` (`lib/connections.ts`). Redirect URIs are built from `APP_URL`, so prod needs `APP_URL=https://cloud.get-brief.app`.
- **Why GitLab and Notion are Brief-held**: Clerk has both, but prod Clerk refuses a fourth social connection on its plan (`402 unsupported_subscription_plan_features: app:unlimited_social`), and Brief-held OAuth works on any plan.
- **Dev** redirect URI for a Brief-held tracker: `http://localhost:3000/api/connect/<provider>/callback`. One app can carry both URIs.
- A Brief-held tracker without its env shows as not available in Settings; nothing breaks.
- Live tests: `lib/<provider>.e2e.test.ts`, skipped unless their `LIVE_*` vars are set. Run from `web/`:
  `node --env-file=.env.local node_modules/vitest/vitest.mjs run lib/<provider>.e2e.test.ts`

---

## GitLab

1. On gitlab.com: avatar, **Edit profile**, **Access**, **Applications**, **Add new application** (https://gitlab.com/-/user_settings/applications). For an app that outlives one account, create it under a group instead: the group, **Settings**, **Applications**.
2. **Name**: Brief. **Redirect URI**, one per line:
   `https://cloud.get-brief.app/api/connect/gitlab/callback`
   `http://localhost:3000/api/connect/gitlab/callback`
3. Leave **Confidential** ticked.
4. **Scopes**: `api` and `read_user`. Filing an issue needs `api`; `read_user` names the account on the card. GitLab refuses an authorize call for a scope the app lacks.
5. **Save application**. Copy the **Application ID** and the **Secret** now: the secret is shown once (losing it means **Renew secret**, which breaks the app until the env is updated).

- **Env**: `GITLAB_CLIENT_ID` (Application ID), `GITLAB_CLIENT_SECRET` (Secret).
- No review: any gitlab.com user can connect. Tokens last two hours; Brief refreshes them, and GitLab revokes each refresh token once used.
- **E2E token**: https://gitlab.com/-/user_settings/personal_access_tokens with the `api` scope. Deleting the test issue needs Owner; below that the test closes it.
  `LIVE_GITLAB_TOKEN`, optional `LIVE_GITLAB_TARGET=<project id>`.

## Azure DevOps

Azure DevOps OAuth goes through Microsoft Entra ID: Microsoft stopped accepting new Azure DevOps OAuth app registrations on April 23, 2025.

1. https://entra.microsoft.com, signed in as at least an Application Developer: **Entra ID**, **App registrations**, **New registration**.
2. **Name**: Brief. **Supported account types**: *Multiple Entra ID tenants*. **Register**, then copy the **Application (client) ID** from Overview.
3. **Authentication**, **Add Redirect URI**, platform **Web**:
   `https://cloud.get-brief.app/api/connect/azure/callback`
   `http://localhost:3000/api/connect/azure/callback`
4. **API permissions**, **Add a permission**, **Azure DevOps** (Microsoft APIs tab), **Delegated permissions**: `vso.work_write`, `vso.project`, `vso.profile`. **Add permissions**. Avoid `user_impersonation`: it grants far more than Brief uses.
5. **Certificates & secrets**, **Client secrets**, **New client secret**, **Add**. Copy the **Value** (not the Secret ID); it is never shown again. It expires (24 months at most), so put a renewal reminder in your calendar.

- **Env**: `AZURE_DEVOPS_CLIENT_ID`, `AZURE_DEVOPS_CLIENT_SECRET`.
- Brief signs in through the `organizations` endpoint and asks for `499b84ac-1321-427f-aa17-267ca6975798/.default offline_access`, so the token carries exactly what step 4 granted.
- **Personal Microsoft accounts can't connect**: Entra issues no Azure DevOps token to them. Work and school accounts only.
- **Customer tenants**: many organizations only let users consent to apps from a verified publisher. Publisher verification needs a Microsoft AI Cloud Partner Program account and a domain you own; without it, a customer's admin grants consent once for their tenant.
- **E2E token**: a PAT at `https://dev.azure.com/<org>/_usersSettings/tokens` with Work Items (Read, write, & manage) and Project and Team (Read).
  `LIVE_AZURE_PAT`, `LIVE_AZURE_ORG=<org>`, optional `LIVE_AZURE_TARGET=<project name or id>`.

## ClickUp

1. In ClickUp, as a Workspace owner or admin: avatar, **Settings**, **Apps**, **Create new app** (https://app.clickup.com/settings/apps).
2. **Name**: Brief. **Redirect URL(s)**: `https://cloud.get-brief.app/api/connect/clickup/callback` (add `http://localhost:3000/api/connect/clickup/callback` if ClickUp accepts it).
3. Save, then **re-open the app and check the redirect URL was stored in full**: ClickUp has been known to cut it down to the domain, which fails every connect with `OAUTH_010`.
4. Copy the **Client ID** and **Client Secret**.

- **Env**: `CLICKUP_CLIENT_ID`, `CLICKUP_CLIENT_SECRET`.
- No scopes and no review: users tick which of their Workspaces Brief may reach on the consent page. Tokens don't expire.
- **E2E token**: same Settings page, **API Token**, Generate (`pk_...`).
  `LIVE_CLICKUP_TOKEN`, optional `LIVE_CLICKUP_TARGET=<list id>`.

## Notion

Notion's "integrations" became "connections" in its developer portal (May 2026).

1. https://app.notion.com/developers/connections: **Build**, **Public connections**, **Create new connection**.
2. **Name**: Brief. Pick your development workspace.
3. **Installation scope**: *Any workspace*. It can't be changed after creation.
4. **Redirect URIs**:
   `https://cloud.get-brief.app/api/connect/notion/callback`
   `http://localhost:3000/api/connect/notion/callback`
5. **Capabilities**: Read content, Update content, Insert content, and *User information with email addresses*.
6. Create, then the **Configuration** tab: copy the **OAuth client ID** and **OAuth client secret**.

- **Env**: `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`.
- No review: a Marketplace listing is optional and the only thing Notion reviews. Users choose which pages and databases Brief can reach on the consent screen; a database they don't share can't be a filing target.
- **E2E token**: an internal connection in the same portal, then share a database with it (database menu, **Connections**).
  `LIVE_NOTION_TOKEN`, optional `LIVE_NOTION_TARGET=<database id>`.

## Trello

1. https://trello.com/apps/admin, **New** (accept the developer agreement the first time).
2. Choose **My app doesn't use Power-up capabilities**.
3. **Name**: Brief, plus Workspace, Email, Support email and Author. **Create**.
4. **Trello Auth** tab, **Generate a new API Key**.
5. On that key, **Allowed origins**: `https://cloud.get-brief.app` and `http://localhost:3000`. Without them Trello refuses every redirect back to Brief.
6. Copy the **API key**. The secret isn't used.

- **Env**: `TRELLO_API_KEY`.
- Brief uses Trello's key-and-token flow (`/1/authorize`, `expiration=never`, `scope=read,write`), still supported. Trello also launched OAuth 2.0 in September 2026; nothing to configure for it.
- **E2E token**: open `https://trello.com/1/authorize?expiration=1day&scope=read,write&response_type=token&key=<API key>` and Allow.
  `LIVE_TRELLO_KEY`, `LIVE_TRELLO_TOKEN`, optional `LIVE_TRELLO_TARGET=<board id>`.

## Asana

1. https://app.asana.com/0/my-apps, **Create new app**, **Name**: Brief.
2. **OAuth** tab, **Redirect URLs**: `https://cloud.get-brief.app/api/connect/asana/callback`. Asana rejects `http://localhost`, so local development needs an https tunnel URL added here too.
3. **Permission scopes**: *Full permissions*. Two endpoints Brief needs (a project's sections, and batch reads) have no granular scope yet. Leave `ASANA_SCOPES` unset.
4. **Manage distribution**: *Any workspace*.
5. Copy the **Client ID** and **Client secret** from the OAuth tab.

- **Env**: `ASANA_CLIENT_ID`, `ASANA_CLIENT_SECRET`.
- No review for *Any workspace* (only an App Directory listing is reviewed). Tokens last an hour; Brief refreshes them.
- **E2E token**: same console, **Personal access tokens**, Create new token.
  `LIVE_ASANA_TOKEN`, optional `LIVE_ASANA_WORKSPACE=<workspace gid>`, `LIVE_ASANA_TARGET=<project gid>`.

## Monday

monday moved to OAuth 2.1 (PKCE, rotating refresh tokens); tokens from the old flow stopped working on October 1, 2026. Brief uses the new flow.

1. In monday.com: avatar, **Developers** (the Developer Center), **Create app**. Name it Brief.
2. **Basic Information**: copy the **Client ID** and **Client Secret**.
3. **OAuth & Permissions**:
   - **Scopes**: `me:read`, `account:read`, `boards:read`, `boards:write`, `updates:write`, `users:read`, `workspaces:read`, `assets:read`.
   - **Redirect URLs**: `https://cloud.get-brief.app/api/connect/monday/callback` (and `http://localhost:3000/api/connect/monday/callback` if monday accepts it).
   - Turn on **New OAuth Flow** for the version.
4. **App versions**: promote the version to **live**.
5. **Share** tab: accept the terms, **Share App**, copy the install link.

- **Env**: `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET`.
- **Each customer account must install the app first**: an admin of that monday account opens the install link from step 5, then its users can connect. No marketplace listing or review is needed for this.
- **E2E token**: Developer Center, **My access tokens**, Show.
  `LIVE_MONDAY_TOKEN`, optional `LIVE_MONDAY_TARGET=<board id>`.

---

## Go live

1. **Apps**: register each app above and collect its credentials.
2. **Database**: migration `0014_tracker_connections.sql` is already applied (dev and prod share one database).
3. **Fly secrets**, staged for the deploy. Generate a fresh `CONNECTIONS_KEY` for prod and never change it afterwards (every stored connection would stop decrypting):
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   ```sh
   fly secrets set --stage \
     APP_URL=https://cloud.get-brief.app \
     CONNECTIONS_KEY=<key> \
     GITLAB_CLIENT_ID=<id> GITLAB_CLIENT_SECRET=<secret> \
     AZURE_DEVOPS_CLIENT_ID=<id> AZURE_DEVOPS_CLIENT_SECRET=<secret> \
     CLICKUP_CLIENT_ID=<id> CLICKUP_CLIENT_SECRET=<secret> \
     NOTION_CLIENT_ID=<id> NOTION_CLIENT_SECRET=<secret> \
     TRELLO_API_KEY=<key> \
     ASANA_CLIENT_ID=<id> ASANA_CLIENT_SECRET=<secret> \
     MONDAY_CLIENT_ID=<id> MONDAY_CLIENT_SECRET=<secret>
   ```
   To keep them out of shell history: put the `NAME=value` lines in a file, `fly secrets import --stage < file`, delete the file. Partial is fine: a tracker whose secrets are missing stays "Soon" in Settings.
4. **Deploy**: `fly deploy` from `web/`.
5. **Check**: Settings, Tracker lists all ten with no "Soon" tag on the ones you configured; connect each once and file a test ticket.
