# Trackers: app registration

Brief files into ten trackers. Each needs an OAuth app on the provider's side.

| Tracker | Token held by | Prod redirect URI | Env |
|---|---|---|---|
| Linear | Brief | `https://cloud.get-brief.app/api/connect/linear/callback` | `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET` |
| Jira | Brief | `https://cloud.get-brief.app/api/connect/jira/callback` | `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET` |
| GitHub | Brief | `https://cloud.get-brief.app/api/connect/github/callback` | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| GitLab | Brief | `https://cloud.get-brief.app/api/connect/gitlab/callback` | `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET` |
| Azure DevOps | Brief | `https://cloud.get-brief.app/api/connect/azure/callback` | `AZURE_DEVOPS_CLIENT_ID`, `AZURE_DEVOPS_CLIENT_SECRET` |
| ClickUp | Brief | `https://cloud.get-brief.app/api/connect/clickup/callback` | `CLICKUP_CLIENT_ID`, `CLICKUP_CLIENT_SECRET` |
| Notion | Brief | `https://cloud.get-brief.app/api/connect/notion/callback` | `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` |
| Trello | Brief | allowed origin `https://cloud.get-brief.app` | `TRELLO_API_KEY` |
| Asana | Brief | `https://cloud.get-brief.app/api/connect/asana/callback` | `ASANA_CLIENT_ID`, `ASANA_CLIENT_SECRET`, optional `ASANA_SCOPES` |
| Monday | Brief | `https://cloud.get-brief.app/api/connect/monday/callback` | `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET` |

- **Brief-held**: routes `/api/connect/<provider>/{start,callback,disconnect}`, tokens AES-256-GCM encrypted in `tracker_connections` under `CONNECTIONS_KEY` (`lib/connections.ts`). Redirect URIs are built from `APP_URL`, so prod needs `APP_URL=https://cloud.get-brief.app`.
- **Clerk** only signs people in to Brief. Linear, Jira and GitHub used to be Clerk connected accounts; [Moving off Clerk](#moving-off-clerk) covers the switch, and [Cleanup after migration](#cleanup-after-migration) what goes once it is done.
- **Why everything is Brief-held**: prod Clerk refuses a fourth social connection on its plan (`402 unsupported_subscription_plan_features: app:unlimited_social`), and Brief-held OAuth works on any plan and for any tracker.
- **Dev** redirect URI: `http://localhost:3000/api/connect/<provider>/callback`. One app can carry both URIs, except Jira: Atlassian allows one callback URL per app, so dev needs an app of its own.
- A Brief-held tracker without its env shows as not available in Settings; nothing breaks.
- Live tests: `lib/<provider>.e2e.test.ts`, skipped unless their `LIVE_*` vars are set. Run from `web/`:
  `node --env-file=.env.local node_modules/vitest/vitest.mjs run lib/<provider>.e2e.test.ts`

---

## Linear

1. In Linear, as a workspace admin: **Settings**, **API**, **OAuth applications**, **+** (https://linear.app/settings/api/applications/new).
2. **Name**: Brief (Linear refuses a name containing "Linear"), plus the developer name and URL. **Callback URLs**, one per line (up to 32):
   `https://cloud.get-brief.app/api/connect/linear/callback`
   `http://localhost:3000/api/connect/linear/callback`
3. Turn on **Public**. A private app, the default, can only be authorized in the workspace that owns it. Webhooks stay off.
4. **Create**, then copy the **Client ID** and **Client secret**.

- **Env**: `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`.
- **Scopes** are asked for at connect time, not set on the app: `read,write` (Linear separates them with commas), with PKCE and `prompt=consent`, so a reconnect can move Brief to another workspace.
- No review: any Linear workspace can connect once the app is public. Access tokens last 24 hours (every Linear OAuth app moved to refresh tokens on April 1, 2026); Brief refreshes them, and Linear rotates the refresh token on each refresh.
- The workspace is the token's own organization: connect stores it, and it is the org key (`linear:<organization id>`), the same key a Clerk connection produced.

## Jira

Atlassian OAuth 2.0 (3LO). An app holds one callback URL, so prod and dev are two apps.

1. https://developer.atlassian.com/console/myapps/: **Create**, **OAuth 2.0 integration**. **Name**: Brief. **Grant type**: *Resource-level*, so a user grants the sites they tick on the consent screen. Agree to the terms, **Create**.
2. **Permissions**: next to **Jira API**, **Add**, then **Configure**, **Edit Scopes**, and tick the classic scopes `read:jira-work`, `write:jira-work` and `read:jira-user`. **Save**.
3. **Authorization**: next to **OAuth 2.0 (3LO)**, **Configure**. **Callback URL**: `https://cloud.get-brief.app/api/connect/jira/callback`. **Save changes**.
4. **Settings**: copy the **Client ID** and **Secret**.
5. **Distribution**: **Edit**, turn on sharing, and fill in what it asks for (the vendor name, the privacy policy URL `https://cloud.get-brief.app/privacy`, the personal data declaration). Without sharing, only the app's owner can authorize it.
6. **Dev**: a second app, *Brief (dev)*, steps 1 to 4 with `http://localhost:3000/api/connect/jira/callback`. It needs no sharing while only you use it.

- **Env**: `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET` (the dev app's pair in `.env.local`).
- Brief asks for `read:jira-work write:jira-work read:jira-user offline_access` with `audience=api.atlassian.com` and `prompt=consent`. `offline_access` is not configured in the console; asking for it is what gets a refresh token. Atlassian documents no PKCE for 3LO, so Jira goes without.
- Access tokens are short-lived. Refresh tokens rotate on every use and lapse after 90 days unused; Brief refreshes and stores each new one.
- **Sites**: connect lists the sites the grant covers (`accessible-resources`). One is stored with its address; several send the user to Settings to pick one (a reconnect keeps the site it had while the grant still covers it), and Jira files nowhere until they do; none refuses the connect. The org key is `jira:<cloud id>`, the same key a Clerk connection produced for the same site.
- **Review**: until Atlassian approves the app, users see a warning that it is not reviewed. Approval follows the Marketplace listing process, and no informative listing is needed. The app works meanwhile.
- **Personal data**: Atlassian asks apps that store personal data to report it through its personal data reporting API. Brief's Jira connection keeps no Atlassian profile data (the card shows the site name) and filed tickets keep only their title and status, so answer the declaration on that basis, and revisit it if that changes.
- `JIRA_API_TOKEN`, `JIRA_EMAIL` and `JIRA_SITE` still give a test deployment a basic-auth Jira account when neither Brief nor Clerk holds one.

## GitHub

A GitHub **OAuth App**, not a GitHub App: an OAuth App acts as the user across every repository they can reach.

1. https://github.com/settings/applications/new, or, so the app outlives one account, an organization's **Settings**, **Developer settings**, **OAuth Apps**, **New OAuth App**.
2. **Application name**: Brief. **Homepage URL**: `https://cloud.get-brief.app`. **Authorization callback URL**: `https://cloud.get-brief.app/api/connect/github/callback`. **Register application**.
3. **Add redirect URI**: `http://localhost:3000/api/connect/github/callback`. OAuth Apps take up to 10 callback URLs since August 14, 2026. Leave wildcard matching off: Brief sends the exact URL.
4. **Generate a new client secret** and copy it with the **Client ID**; the secret is shown once.
5. Leave short-lived user tokens on (the app's optional features), the default for new apps: tokens last eight hours and Brief refreshes them (the refresh token lasts six months and is replaced on each use). An app with them off issues tokens that never expire, which works too.

- **Env**: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.
- **Scopes** are asked for at connect time: `repo` (filing into private repositories as well as public ones) and `read:user` (the account's name on the card), with PKCE.
- **Organizations**: an organization with OAuth App access restrictions on hides its private repositories from Brief until an owner approves the app. Members can request approval from the consent screen.
- **Org pick**: one organization is stored at connect, several are offered on Settings, none is fine (personal repositories still file). A reconnect keeps the org it had, and an org picked for a Clerk connection is carried over, when the new token can see it; when the listing fails, the Clerk-era pick stays in Clerk and Settings checks it again. The org key is `github:<login, lowercased>`, as before.
- **Token cap**: GitHub keeps at most ten tokens per user, app and scope set, revoking the oldest past that, and creates at most ten an hour. A dev app of your own keeps localhost testing from revoking your production token.

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

## Moving off Clerk

Linear, Jira and GitHub moved from Clerk connected accounts to Brief-held OAuth. Nobody has to reconnect:

- **Before their apps exist**: with no `LINEAR_*`, `JIRA_*` or `GITHUB_*` secrets, `/api/me/connections` reports them not configured and Connect still goes through Clerk, exactly as before. Deploying the code first changes nothing. If that read fails, Connect asks again and shows an error rather than guess.
- **Once a secret pair is set**: Connect runs Brief's flow. A Brief connect removes the user's Clerk tracker accounts, that tracker's own included, once the new token is stored. A Clerk connect, where one still happens, removes that tracker's Brief row.
- **Users still on Clerk** keep filing: `lib/tracker-tokens.ts` falls back to the Clerk token only when Brief holds no row at all. A Brief row that can't be used (a refused refresh, a store outage) makes the tracker stale instead, since an old Clerk token could file into another account's workspace. Clerk users count as connected everywhere (Settings, health, filing, org), and Disconnect removes the Clerk account server side.
- **Sign-in guard**: a Clerk tracker account that is a user's only way to sign in (no password, no other external account, no email verified other than through it) is never removed; it is logged and left for the account page.
- **Orgs stay put**: the org key is the Linear organization id, the Jira cloud id and the GitHub login on either path. A Clerk Jira keeps filing into its token's first site; a Brief one files into the site picked for it.

## Cleanup after migration

Once no user on either Clerk instance has an `oauth_linear`, `oauth_atlassian` or `oauth_github` external account left (Clerk's backend `getUserList`, filtered on `externalAccounts`), remove:

- `lib/tracker-tokens.ts`'s Clerk fallbacks, then `getLinearToken`, `getGithubToken` and the Clerk half of `getJiraAuth` (keep the `JIRA_API_TOKEN` branch if test deployments still use it) and the first-site `getJiraCloud`.
- `lib/clerk-strategies.ts` and the `NEXT_PUBLIC_*_CLERK_STRATEGY` env; `clerkStrategy`, `clerkMatch`, `CLERK_PROVIDERS`, `connectedProviders` and the `clerkKnown` handling in `lib/trackers/registry.ts`; `lib/clerk-trackers.ts` and its calls in the connect callback and the disconnect route.
- The Clerk connect path in `components/useTrackerConnect.ts` (`createExternalAccount`, reverification, the email linking and pending-account copy), the account-settings fallback in `components/Integrations.tsx`, and `app/api/account/link-email` once nothing calls it.
- The `githubOrg` privateMetadata reads and writes in `lib/workspaces.ts` (`legacyGithubPick`, `forgetLegacyGithubPick`, `adoptLegacyGithubPick`, `writeGithubPick`'s Clerk branch) and the legacy pick in the callback's `keptPick`.
- In `lib/org-server.ts`: the Clerk branch of `jiraOrg`, and the Clerk-down fallback in `resolveFromTrackers` that tries Linear, Jira and GitHub whenever Clerk can't be read.
- The Linear, Atlassian and GitHub social connections on both Clerk instances, the Clerk sentences in the privacy page, and Clerk as a holder of tracker tokens in the Chrome Web Store data disclosure.

## Go live

1. **Apps**: register each app above and collect its credentials.
2. **Database**: migration `0014_tracker_connections.sql` is already applied (dev and prod share one database).
3. **Fly secrets**, staged for the deploy. Generate a fresh `CONNECTIONS_KEY` for prod and never change it afterwards (every stored connection would stop decrypting):
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   ```sh
   fly secrets set --stage \
     APP_URL=https://cloud.get-brief.app \
     CONNECTIONS_KEY=<key> \
     LINEAR_CLIENT_ID=<id> LINEAR_CLIENT_SECRET=<secret> \
     JIRA_CLIENT_ID=<id> JIRA_CLIENT_SECRET=<secret> \
     GITHUB_CLIENT_ID=<id> GITHUB_CLIENT_SECRET=<secret> \
     GITLAB_CLIENT_ID=<id> GITLAB_CLIENT_SECRET=<secret> \
     AZURE_DEVOPS_CLIENT_ID=<id> AZURE_DEVOPS_CLIENT_SECRET=<secret> \
     CLICKUP_CLIENT_ID=<id> CLICKUP_CLIENT_SECRET=<secret> \
     NOTION_CLIENT_ID=<id> NOTION_CLIENT_SECRET=<secret> \
     TRELLO_API_KEY=<key> \
     ASANA_CLIENT_ID=<id> ASANA_CLIENT_SECRET=<secret> \
     MONDAY_CLIENT_ID=<id> MONDAY_CLIENT_SECRET=<secret>
   ```
   To keep them out of shell history: put the `NAME=value` lines in a file, `fly secrets import --stage < file`, delete the file. Partial is fine: a tracker whose secrets are missing stays "Soon" in Settings, except Linear, Jira and GitHub, which keep connecting through Clerk.
4. **Chrome Web Store**: once the Linear, Jira or GitHub secrets are live, Brief Cloud stores those trackers' tokens itself. Update the listing's "Privacy practices" data disclosure to match the privacy page (`app/privacy/page.tsx`), which already covers both places a token can be held.
5. **Deploy**: `fly deploy` from `web/`.
6. **Check**: Settings, Tracker lists all ten with no "Soon" tag on the ones you configured; connect each once and file a test ticket. For Linear, Jira and GitHub, check that the connect left no Clerk account behind (Clerk dashboard, the user's connected accounts).
