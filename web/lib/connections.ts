// App-owned tracker connections: the OAuth dance and encrypted token store for
// every tracker whose token Clerk does not hold (GitLab, Azure DevOps, ClickUp,
// Notion, Trello, Asana, Monday).
//
// Everything Clerk-backed (Linear, Jira, GitHub) stays on
// getUserOauthAccessToken and never touches this file. The two paths meet only
// at the registry, which hands the rest of the app a Tracker either way.

import { cache } from "react";
import { createAdminSupabase } from "@/lib/supabase/server";
import { decryptToken, encryptToken } from "@/lib/crypto";
import type { ProviderKey, Workspace } from "@/lib/tracker";

/** Providers whose tokens we own. The rest come from Clerk. */
export type OwnedProvider = "gitlab" | "azure" | "clickup" | "notion" | "trello" | "asana" | "monday";

/** In the registry's order, which the Connections page lists them in. */
export const OWNED_PROVIDERS: OwnedProvider[] = ["gitlab", "azure", "clickup", "notion", "trello", "asana", "monday"];

export function isOwnedProvider(p: string): p is OwnedProvider {
  return (OWNED_PROVIDERS as string[]).includes(p);
}

/** A live connection, decrypted and guaranteed unexpired. */
export type Connection = {
  provider: OwnedProvider;
  accessToken: string;
  /**
   * Resolved at connect time: the picked workspace (workspaceId,
   * workspaceName), a display label, and provider handles such as the Trello
   * member id.
   */
  meta: Record<string, string>;
};

/**
 * The workspace a connection was pinned to, or null before one is picked.
 * A missing name falls back to the id so a card never shows a blank.
 */
export function connectionWorkspace(c: Connection): Workspace | null {
  return metaWorkspace(c.meta);
}

/** connectionWorkspace for a row's account_meta, read without its token. */
export function metaWorkspace(meta: Record<string, string>): Workspace | null {
  const id = meta.workspaceId;
  if (!id) return null;
  return { id, name: meta.workspaceName || id };
}

type Row = {
  provider: string;
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: string | null;
  account_meta: Record<string, string> | null;
};

/**
 * CONNECTIONS_KEY when it is a usable AES-256 key (base64 of exactly 32 bytes),
 * else null. Checked up front so a malformed key reads as "not configured" on
 * the Connections page, instead of failing deep in the callback with Node's
 * "Invalid key length".
 */
function usableKey(): string | null {
  const k = process.env.CONNECTIONS_KEY;
  if (!k) return null;
  return Buffer.from(k, "base64").length === 32 ? k : null;
}

function key(): string {
  const k = usableKey();
  if (!k) {
    throw new Error(
      "CONNECTIONS_KEY is missing or not base64 of 32 bytes - tracker connections cannot be encrypted or decrypted.",
    );
  }
  return k;
}

/**
 * APP_URL's origin when it is a usable http(s) URL, else null. The connect
 * routes fall back to the request's own origin; a token refresh runs without
 * a request, so this is the only origin it has.
 */
export function configuredOrigin(): string | null {
  const configured = (process.env.APP_URL ?? "").trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * For logs. Only used on database, key and decrypt errors, whose messages
 * never carry a token (refresh logs its own, more carefully).
 */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Provider specs
// ---------------------------------------------------------------------------

/**
 * What each owned provider needs to complete an OAuth flow. Trello is the odd
 * one out: it has no token endpoint at all (its flow hands the token straight
 * back in the redirect fragment), so `tokenUrl` is empty and the callback route
 * takes the client-side branch.
 */
export type OwnedSpec = {
  authorizeUrl: string;
  /** Empty for Trello, which issues the token in the redirect itself. */
  tokenUrl: string;
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  /** Empty means the provider takes no scope param, so none is sent. */
  scope: string;
  /** Extra query params on the authorize URL. */
  authorizeExtra?: Record<string, string>;
  /**
   * The code exchange's own fields, for a provider that wants other than
   * grant_type, code and redirect_uri (ClickUp). The app's credentials are
   * added by requestToken either way.
   */
  tokenBody?: (params: { code: string; redirectUri: string }) => Record<string, string>;
  /**
   * How the token endpoint takes the app's credentials: client_id and
   * client_secret beside the grant's fields (the default), or HTTP Basic with
   * a JSON body, the only form Notion accepts.
   */
  tokenAuth?: "body" | "basic-json";
  /** False keeps the scope off token requests; it is still sent to authorize. */
  tokenScope?: boolean;
  /** Send redirect_uri on a refresh as well as on the code exchange. */
  refreshRedirectUri?: boolean;
};

export const OWNED_SPECS: Record<OwnedProvider, OwnedSpec> = {
  gitlab: {
    // gitlab.com only: self-managed GitLab would need a host per user.
    authorizeUrl: "https://gitlab.com/oauth/authorize",
    tokenUrl: "https://gitlab.com/oauth/token",
    clientId: () => process.env.GITLAB_CLIENT_ID,
    clientSecret: () => process.env.GITLAB_CLIENT_SECRET,
    // Filing an issue is an API write, and GitLab has no narrower scope than
    // `api` that allows one. read_user names the account on the card.
    scope: "api read_user",
    // The grant already holds the scope. GitLab's token requests do not take
    // it, and on a refresh a scope would narrow the grant rather than restate it.
    tokenScope: false,
    // GitLab documents redirect_uri on a refresh too.
    refreshRedirectUri: true,
  },
  azure: {
    // Azure DevOps is reached through an Entra ID app, using the ADO resource
    // scope. The .default form inherits whatever the app registration was
    // granted, so the scopes live in Azure rather than hardcoded here.
    // `organizations`, not `common`: Entra can't issue an Azure DevOps token to
    // a personal Microsoft account, so offering that sign-in only dead-ends.
    authorizeUrl: "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
    // Not AZURE_CLIENT_ID: Azure SDKs' DefaultAzureCredential reads that name,
    // and an explicit one keeps this OAuth app from colliding with it.
    clientId: () => process.env.AZURE_DEVOPS_CLIENT_ID,
    clientSecret: () => process.env.AZURE_DEVOPS_CLIENT_SECRET,
    scope: "499b84ac-1321-427f-aa17-267ca6975798/.default offline_access",
  },
  clickup: {
    authorizeUrl: "https://app.clickup.com/api",
    tokenUrl: "https://api.clickup.com/api/v2/oauth/token",
    clientId: () => process.env.CLICKUP_CLIENT_ID,
    clientSecret: () => process.env.CLICKUP_CLIENT_SECRET,
    // ClickUp grants everything the installing user can see; it has no scope param.
    scope: "",
    // ClickUp's token endpoint takes client_id, client_secret and code in the
    // body, and nothing else: no grant_type, no redirect_uri.
    tokenBody: ({ code }) => ({ code }),
  },
  notion: {
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    clientId: () => process.env.NOTION_CLIENT_ID,
    clientSecret: () => process.env.NOTION_CLIENT_SECRET,
    // Notion OAuth has no scopes: what Brief may do is set on the integration
    // itself, and which pages it may reach is chosen by the user on consent.
    scope: "",
    // A public integration's authorize URL must say the user owns the grant.
    authorizeExtra: { owner: "user" },
    tokenAuth: "basic-json",
  },
  trello: {
    authorizeUrl: "https://trello.com/1/authorize",
    tokenUrl: "",
    clientId: () => process.env.TRELLO_API_KEY,
    clientSecret: () => process.env.TRELLO_API_SECRET,
    scope: "read,write",
    authorizeExtra: {
      // expiration=never because a Brief connection that silently dies in 30
      // days would look like a broken integration, not an expired grant.
      expiration: "never",
      response_type: "token",
      name: "Brief",
    },
  },
  asana: {
    authorizeUrl: "https://app.asana.com/-/oauth_authorize",
    tokenUrl: "https://app.asana.com/-/oauth_token",
    clientId: () => process.env.ASANA_CLIENT_ID,
    clientSecret: () => process.env.ASANA_CLIENT_SECRET,
    // Empty = the permissions configured on the Asana app itself. A getter so
    // the env is read when a flow runs, not once when this module loads.
    get scope() {
      return process.env.ASANA_SCOPES ?? "";
    },
  },
  monday: {
    // monday's OAuth 2.1 flow: tokens from the old /oauth2/token endpoint
    // stopped working on 2026-10-01. It requires PKCE (connect-flow) and
    // issues rotating refresh tokens, which refresh() handles like GitLab's.
    authorizeUrl: "https://auth.monday.com/oauth2/authorize",
    tokenUrl: "https://auth.monday.com/oauth_ms/oauth/token",
    clientId: () => process.env.MONDAY_CLIENT_ID,
    clientSecret: () => process.env.MONDAY_CLIENT_SECRET,
    // account:read because the connect callback names the one account a
    // token belongs to (listMondayAccount reads `me { account }`).
    scope: "me:read account:read boards:read boards:write updates:write users:read workspaces:read assets:read",
    // The grant already holds the scope; on a refresh a scope could narrow it.
    tokenScope: false,
  },
};

/**
 * Is this provider actually usable on this deployment? An app-owned connection
 * needs its OAuth app credentials AND the key its token is encrypted with.
 *
 * The Connections page asks for this so an unconfigured tracker can say so on
 * the card, instead of letting someone click Connect and land on an error from
 * the start route.
 */
export function isProviderConfigured(provider: OwnedProvider): boolean {
  const spec = OWNED_SPECS[provider];
  if (!spec) return false;
  if (!usableKey()) return false;
  // Trello has no token endpoint, so it never uses the secret to exchange a
  // code - only the API key, which it sends alongside every request.
  const needsSecret = !!spec.tokenUrl;
  return !!spec.clientId() && (!needsSecret || !!spec.clientSecret());
}

/** The callback URL registered with each provider. */
export function redirectUri(origin: string, provider: OwnedProvider): string {
  return `${origin}/api/connect/${provider}/callback`;
}

/**
 * POST a grant to the provider's token endpoint, for a code exchange or a
 * refresh. `grant` holds the grant's own fields; this adds the app's
 * credentials where the provider takes them, and the scope where it wants it
 * repeated. The caller reads the reply and never logs it.
 */
export function requestToken(spec: OwnedSpec, grant: Record<string, string>): Promise<Response> {
  const clientId = spec.clientId() ?? "";
  const clientSecret = spec.clientSecret() ?? "";
  const url = new URL(spec.tokenUrl);
  const headers: Record<string, string> = { Accept: "application/json" };

  if (spec.tokenAuth === "basic-json") {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    headers["Content-Type"] = "application/json";
    return fetch(url.toString(), { method: "POST", headers, body: JSON.stringify(grant) });
  }

  const fields: Record<string, string> = { client_id: clientId, client_secret: clientSecret, ...grant };
  // Asana with no ASANA_SCOPES has no scope to send, and an empty scope param
  // is not the same as none to every provider.
  if (spec.scope && spec.tokenScope !== false) fields.scope = spec.scope;
  headers["Content-Type"] = "application/x-www-form-urlencoded";
  return fetch(url.toString(), { method: "POST", headers, body: new URLSearchParams(fields) });
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// supabase-js resolves with `{ error }` instead of rejecting, so every write
// below checks it: otherwise a failed save would report a connection that was
// never stored.

export async function saveConnection(
  userId: string,
  provider: OwnedProvider,
  data: {
    accessToken: string;
    refreshToken?: string;
    expiresInSeconds?: number;
    meta?: Record<string, string>;
  },
): Promise<void> {
  const admin = createAdminSupabase();
  const k = key();
  const { error } = await admin.from("tracker_connections").upsert(
    {
      user_id: userId,
      provider,
      access_token_enc: encryptToken(data.accessToken, k),
      refresh_token_enc: data.refreshToken ? encryptToken(data.refreshToken, k) : null,
      expires_at: data.expiresInSeconds
        ? new Date(Date.now() + data.expiresInSeconds * 1000).toISOString()
        : null,
      account_meta: data.meta ?? {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  );
  if (error) throw new Error(error.message);
}

/**
 * Merge `patch` into a connection's account_meta, keeping every other key. The
 * workspace pick lands here after connect, so it must not wipe the handles the
 * callback resolved. Throws when the user has no such connection.
 */
export async function setConnectionMeta(
  userId: string,
  provider: OwnedProvider,
  patch: Record<string, string>,
): Promise<void> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("tracker_connections")
    .select("account_meta")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`No ${provider} connection to update.`);

  const current = (data as { account_meta: Record<string, string> | null }).account_meta ?? {};
  const { error: updateError } = await admin
    .from("tracker_connections")
    .update({ account_meta: { ...current, ...patch }, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("provider", provider);
  if (updateError) throw new Error(updateError.message);
}

export async function deleteConnection(userId: string, provider: OwnedProvider): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin
    .from("tracker_connections")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider);
  if (error) throw new Error(error.message);
}

/** Drop every owned connection except `keep` - the one-tracker-at-a-time rule. */
export async function deleteOtherConnections(userId: string, keep?: ProviderKey): Promise<void> {
  const admin = createAdminSupabase();
  const doomed = OWNED_PROVIDERS.filter((p) => p !== keep);
  if (!doomed.length) return;
  const { error } = await admin
    .from("tracker_connections")
    .delete()
    .eq("user_id", userId)
    .in("provider", doomed);
  if (error) throw new Error(error.message);
}

/**
 * A connection's account_meta (the workspace pick, the account label, provider
 * handles), or null when the user has no such connection. Reads that column
 * alone: nothing is decrypted and no token is refreshed, so the org lookup,
 * which runs on every page and every filing, never reaches a tracker. Throws
 * on a database error, since an outage is not "not connected".
 */
export async function readConnectionMeta(
  userId: string,
  provider: OwnedProvider,
): Promise<Record<string, string> | null> {
  const { data, error } = await createAdminSupabase()
    .from("tracker_connections")
    .select("account_meta")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return (data as { account_meta: Record<string, string> | null }).account_meta ?? {};
}

/**
 * Which owned providers this user has connected (no tokens decrypted). Cached
 * per render because Settings and the tracker cards each ask for it, and one
 * render should read the table once.
 */
export const listConnectedProviders = cache(async function listConnectedProviders(
  userId: string,
): Promise<OwnedProvider[]> {
  try {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("tracker_connections")
      .select("provider")
      .eq("user_id", userId);
    // supabase-js resolves an outage as `{ error }`; throw so it gets logged.
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.provider as string).filter(isOwnedProvider);
  } catch (err) {
    console.warn("[connections] could not list connections:", errorMessage(err));
    return [];
  }
});

/**
 * How early a token is treated as expired. A filing run can take five minutes
 * (the export and process routes allow 300s) on the token it started with, so
 * a token is refreshed while it still has ten minutes left, not one.
 */
const REFRESH_SKEW_MS = 10 * 60_000;

function isExpiring(expiresAt: string | null): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() - REFRESH_SKEW_MS < Date.now();
}

/** How long a token must still have for a failed refresh to fall back on it. */
const LAST_RESORT_MS = 60_000;

/**
 * The stored access token when a refresh failed but the token has not run out.
 * Refreshing starts ten minutes early, so a provider blip in that window would
 * otherwise drop a connection whose token still works.
 */
function stillUsable(row: Row): string | null {
  if (!row.expires_at || new Date(row.expires_at).getTime() - LAST_RESORT_MS < Date.now()) return null;
  return decryptToken(row.access_token_enc, key());
}

/**
 * The access token another refresh stored after `row` was read, when it is
 * still live, else null. GitLab and monday rotate refresh tokens and revoke the
 * old one on use, so of two refreshes racing on one row from two server machines, the
 * second is refused although the connection is fine. Read once: this rescues
 * a lost race, it is not a retry.
 */
async function refreshedElsewhere(userId: string, row: Row): Promise<string | null> {
  const { data, error } = await createAdminSupabase()
    .from("tracker_connections")
    .select("access_token_enc, expires_at")
    .eq("user_id", userId)
    .eq("provider", row.provider)
    .maybeSingle();
  if (error || !data) return null;
  const fresh = data as Pick<Row, "access_token_enc" | "expires_at">;
  // Every encryption draws a fresh IV, so the same ciphertext means nothing
  // was written since the row was read.
  if (fresh.access_token_enc === row.access_token_enc || isExpiring(fresh.expires_at)) return null;
  return decryptToken(fresh.access_token_enc, key());
}

async function refresh(userId: string, row: Row): Promise<string | null> {
  const provider = row.provider as OwnedProvider;
  const spec = OWNED_SPECS[provider];
  if (!spec?.tokenUrl || !row.refresh_token_enc) return null;
  if (!spec.clientId() || !spec.clientSecret()) return null;

  try {
    const grant: Record<string, string> = {
      grant_type: "refresh_token",
      refresh_token: decryptToken(row.refresh_token_enc, key()),
    };
    if (spec.refreshRedirectUri) {
      // Built the way the connect flow built it. Without APP_URL there is no
      // origin to build it from, and the refresh goes without one.
      const origin = configuredOrigin();
      if (origin) grant.redirect_uri = redirectUri(origin, provider);
    }
    const r = await requestToken(spec, grant);
    if (!r.ok) {
      const rotated = await refreshedElsewhere(userId, row);
      if (rotated) return rotated;
      // Usually a revoked grant. The status alone says so; the body is never
      // logged, since a token endpoint's reply is not ours to print.
      console.warn(`[connections] ${provider} refused the token refresh: ${r.status}`);
      return null;
    }
    const j = (await r.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!j.access_token) return null;

    // Only the token columns, and only on a row that still exists. The token
    // request is a network round trip; meanwhile the user may have disconnected
    // (or connected another tracker, which deletes this row) or picked a
    // workspace. An upsert of the row read before the request would bring a
    // deleted connection back, or put the old account_meta over the new pick.
    const k = key();
    const patch: Record<string, string | null> = {
      access_token_enc: encryptToken(j.access_token, k),
      expires_at: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    // Entra, GitLab and monday rotate refresh tokens and Asana never sends a new one;
    // the column is only touched when a new one comes back.
    if (j.refresh_token) patch.refresh_token_enc = encryptToken(j.refresh_token, k);
    const { error } = await createAdminSupabase()
      .from("tracker_connections")
      .update(patch)
      .eq("user_id", userId)
      .eq("provider", provider);
    if (error) {
      // The fresh token is good whether or not it was stored, so this run still
      // files; the next call refreshes again from the refresh token on the row.
      console.warn(`[connections] could not store a refreshed ${provider} token:`, error.message);
    }
    return j.access_token;
  } catch (err) {
    // The name only: a JSON parse error's message quotes the response body,
    // which may hold a token.
    console.warn(
      `[connections] ${provider} token refresh failed:`,
      err instanceof Error ? err.name : "unknown error",
    );
    return null;
  }
}

/**
 * Refreshes in flight in this process, by provider and user. One render asks
 * for the same connection from several places at once, and GitLab revokes a
 * refresh token on its first use, so every refresh after the first would be
 * refused. They share the first one's answer instead.
 */
const refreshing = new Map<string, Promise<string | null>>();

function refreshOnce(userId: string, row: Row): Promise<string | null> {
  const k = `${row.provider}:${userId}`;
  const inFlight = refreshing.get(k);
  if (inFlight) return inFlight;
  // refresh never rejects, so the entry is always cleared.
  const p = refresh(userId, row).finally(() => refreshing.delete(k));
  refreshing.set(k, p);
  return p;
}

/**
 * The single accessor for an owned connection. Decrypts, refreshes when the
 * token is expiring, and returns null (rather than throwing) when the user
 * simply hasn't connected this provider - the same "no tracker connected"
 * shape the Clerk path degrades to.
 */
export async function getConnection(
  userId: string,
  provider: OwnedProvider,
): Promise<Connection | null> {
  try {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("tracker_connections")
      .select("provider, access_token_enc, refresh_token_enc, expires_at, account_meta")
      .eq("user_id", userId)
      .eq("provider", provider)
      .maybeSingle();
    // An outage is not "not connected"; throw so the catch logs it.
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as Row;

    const token = isExpiring(row.expires_at)
      ? ((await refreshOnce(userId, row)) ?? stillUsable(row))
      : decryptToken(row.access_token_enc, key());
    if (!token) return null;

    return { provider, accessToken: token, meta: row.account_meta ?? {} };
  } catch (err) {
    // A database outage or an undecryptable row (wrong CONNECTIONS_KEY) reads
    // as "not connected" to the caller, so say which it was here.
    console.warn(`[connections] could not read the ${provider} connection:`, errorMessage(err));
    return null;
  }
}
