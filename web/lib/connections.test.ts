import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { decryptToken, encryptToken } from "@/lib/crypto";

/**
 * An in-memory tracker_connections table keyed `user_id|provider`, behind a
 * fake Supabase client that answers the query chains connections.ts uses. Like
 * the real client, it RESOLVES with `{ error }` rather than rejecting, so the
 * tests can pin down that a failed write is reported instead of swallowed.
 * `failWith` fails every call; `failWrites` fails only upsert, update and
 * delete, so reads still work.
 */
const db = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  failWith: null as { message: string } | null,
  failWrites: null as { message: string } | null,
}));

vi.mock("@/lib/supabase/server", () => {
  type Row = Record<string, unknown>;
  const rowKey = (r: Row) => `${r.user_id}|${r.provider}`;

  function pick(row: Row, cols: string): Row {
    const out: Row = {};
    for (const c of cols.split(",").map((s) => s.trim())) out[c] = row[c];
    return out;
  }

  // One builder for select, update and delete: `.eq()` and `.in()` narrow the
  // rows, and the chain runs when awaited (or through `.maybeSingle()`).
  function query(write: boolean, run: (hits: [string, Row][]) => Row[] | null) {
    const filters: ((r: Row) => boolean)[] = [];
    const settle = () => {
      const failure = db.failWith ?? (write ? db.failWrites : null);
      if (failure) return { data: null, error: failure };
      const hits = [...db.rows.entries()].filter(([, r]) => filters.every((f) => f(r)));
      return { data: run(hits), error: null };
    };
    const builder = {
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return builder;
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col]));
        return builder;
      },
      async maybeSingle() {
        const { data, error } = settle();
        return { data: data?.[0] ?? null, error };
      },
      then<T>(resolve: (v: ReturnType<typeof settle>) => T, reject?: (e: unknown) => T) {
        return Promise.resolve(settle()).then(resolve, reject);
      },
    };
    return builder;
  }

  function from(table: string) {
    if (table !== "tracker_connections") throw new Error(`unexpected table ${table}`);
    return {
      async upsert(row: Row, opts: { onConflict: string }) {
        if (opts.onConflict !== "user_id,provider") throw new Error("upsert without the unique key");
        const failure = db.failWith ?? db.failWrites;
        if (failure) return { error: failure };
        db.rows.set(rowKey(row), { ...db.rows.get(rowKey(row)), ...row });
        return { error: null };
      },
      select: (cols: string) => query(false, (hits) => hits.map(([, r]) => pick(r, cols))),
      update: (patch: Row) =>
        query(true, (hits) => {
          for (const [k, r] of hits) db.rows.set(k, { ...r, ...patch });
          return null;
        }),
      delete: () =>
        query(true, (hits) => {
          for (const [k] of hits) db.rows.delete(k);
          return null;
        }),
    };
  }

  return { createAdminSupabase: () => ({ from }) };
});

import {
  connectionWorkspace,
  deleteConnection,
  deleteOtherConnections,
  getConnection,
  isProviderConfigured,
  listConnectedProviders,
  readConnection,
  readConnectionMeta,
  saveConnection,
  setConnectionMeta,
} from "@/lib/connections";

const KEY = Buffer.alloc(32, 7).toString("base64");
const USER = "user_1";

/** A stored row whose access token has already expired, as if from long ago. */
function seedExpired(provider: string, refreshToken: string) {
  seedExpiringIn(provider, refreshToken, -5 * 60_000);
}

/** A stored row whose access token runs out `ms` from now (negative: already out). */
function seedExpiringIn(provider: string, refreshToken: string, ms: number) {
  db.rows.set(`${USER}|${provider}`, {
    user_id: USER,
    provider,
    access_token_enc: encryptToken("old", KEY),
    refresh_token_enc: encryptToken(refreshToken, KEY),
    expires_at: new Date(Date.now() + ms).toISOString(),
    account_meta: { workspaceId: "org-1", label: "Razi" },
  });
}

/**
 * Stub the token endpoint. With `gate`, the answer waits until the gate
 * resolves, so a test can change the table while a refresh is in flight.
 */
function stubTokenEndpoint(
  response: { ok: boolean; status: number; json?: unknown },
  gate?: Promise<void>,
) {
  type TokenResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<TokenResponse>>(
    async () => {
      await gate;
      return {
        ok: response.ok,
        status: response.status,
        json: async () => response.json ?? {},
      };
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** A promise the test resolves by hand. */
function gate() {
  let open!: () => void;
  const closed = new Promise<void>((resolve) => (open = resolve));
  return { closed, open };
}

const NEW_TOKEN = { ok: true, status: 200, json: { access_token: "new", expires_in: 3600 } };

function sentBody(fetchMock: ReturnType<typeof stubTokenEndpoint>): URLSearchParams {
  return fetchMock.mock.calls[0][1].body as URLSearchParams;
}

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  db.rows.clear();
  db.failWith = null;
  db.failWrites = null;
  vi.stubEnv("CONNECTIONS_KEY", KEY);
  // The module warns on purpose in several cases; keep the run quiet and let
  // tests inspect what was said.
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("saveConnection / getConnection", () => {
  it("stores tokens encrypted and reads them back", async () => {
    await saveConnection(USER, "clickup", {
      accessToken: "pk_live_secret_token",
      meta: { workspaceId: "9", workspaceName: "Acme" },
    });

    // A database dump alone must not hand over the tracker.
    const stored = db.rows.get(`${USER}|clickup`);
    expect(stored).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain("pk_live_secret_token");

    const conn = await getConnection(USER, "clickup");
    expect(conn?.accessToken).toBe("pk_live_secret_token");
    expect(conn?.provider).toBe("clickup");
    expect(connectionWorkspace(conn!)).toEqual({ id: "9", name: "Acme" });
  });

  it("refreshes an expiring token and keeps the refresh token when none comes back", async () => {
    vi.stubEnv("AZURE_DEVOPS_CLIENT_ID", "ado-client");
    vi.stubEnv("AZURE_DEVOPS_CLIENT_SECRET", "ado-secret");
    seedExpired("azure", "refresh-1");
    const fetchMock = stubTokenEndpoint({
      ok: true,
      status: 200,
      json: { access_token: "new", expires_in: 3600 },
    });

    const conn = await getConnection(USER, "azure");

    expect(conn?.accessToken).toBe("new");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
    );
    const body = sentBody(fetchMock);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-1");
    expect(body.get("client_id")).toBe("ado-client");

    // The new access token is stored, the old refresh token survives, and the
    // meta resolved at connect time is left alone.
    const stored = db.rows.get(`${USER}|azure`)!;
    expect(decryptToken(stored.access_token_enc as string, KEY)).toBe("new");
    expect(decryptToken(stored.refresh_token_enc as string, KEY)).toBe("refresh-1");
    expect(new Date(stored.expires_at as string).getTime()).toBeGreaterThan(Date.now());
    expect(stored.account_meta).toEqual({ workspaceId: "org-1", label: "Razi" });
  });

  it("omits scope from an asana refresh when ASANA_SCOPES is unset", async () => {
    vi.stubEnv("ASANA_CLIENT_ID", "asana-client");
    vi.stubEnv("ASANA_CLIENT_SECRET", "asana-secret");
    vi.stubEnv("ASANA_SCOPES", undefined);
    seedExpired("asana", "asana-refresh");
    const fetchMock = stubTokenEndpoint({
      ok: true,
      status: 200,
      json: { access_token: "new", expires_in: 3600 },
    });

    const conn = await getConnection(USER, "asana");

    expect(conn?.accessToken).toBe("new");
    expect(fetchMock.mock.calls[0][0]).toBe("https://app.asana.com/-/oauth_token");
    const body = sentBody(fetchMock);
    expect(body.has("scope")).toBe(false);
    expect(body.get("grant_type")).toBe("refresh_token");
  });

  it("sends ASANA_SCOPES when it is set, read at call time", async () => {
    vi.stubEnv("ASANA_CLIENT_ID", "asana-client");
    vi.stubEnv("ASANA_CLIENT_SECRET", "asana-secret");
    vi.stubEnv("ASANA_SCOPES", "tasks:read tasks:write");
    seedExpired("asana", "asana-refresh");
    const fetchMock = stubTokenEndpoint({
      ok: true,
      status: 200,
      json: { access_token: "new", expires_in: 3600 },
    });

    await getConnection(USER, "asana");

    expect(sentBody(fetchMock).get("scope")).toBe("tasks:read tasks:write");
  });

  it("returns null when the refresh is refused", async () => {
    vi.stubEnv("AZURE_DEVOPS_CLIENT_ID", "ado-client");
    vi.stubEnv("AZURE_DEVOPS_CLIENT_SECRET", "ado-secret");
    seedExpired("azure", "revoked-refresh");
    const before = { ...db.rows.get(`${USER}|azure`) };
    const fetchMock = stubTokenEndpoint({ ok: false, status: 400 });

    expect(await getConnection(USER, "azure")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A refused refresh must not overwrite the row with anything.
    expect(db.rows.get(`${USER}|azure`)).toEqual(before);
  });

  it("stores a rotated refresh token when one comes back", async () => {
    vi.stubEnv("AZURE_DEVOPS_CLIENT_ID", "ado-client");
    vi.stubEnv("AZURE_DEVOPS_CLIENT_SECRET", "ado-secret");
    seedExpired("azure", "refresh-1");
    stubTokenEndpoint({
      ok: true,
      status: 200,
      json: { access_token: "new", refresh_token: "refresh-2", expires_in: 3600 },
    });

    await getConnection(USER, "azure");

    const stored = db.rows.get(`${USER}|azure`)!;
    expect(decryptToken(stored.refresh_token_enc as string, KEY)).toBe("refresh-2");
  });

  it("still returns the refreshed token when storing it fails", async () => {
    vi.stubEnv("AZURE_DEVOPS_CLIENT_ID", "ado-client");
    vi.stubEnv("AZURE_DEVOPS_CLIENT_SECRET", "ado-secret");
    seedExpired("azure", "refresh-1");
    stubTokenEndpoint({
      ok: true,
      status: 200,
      json: { access_token: "fresh-access-token", expires_in: 3600 },
    });
    db.failWrites = { message: "write refused" };

    // The token is valid whether or not it was stored, so this run still files.
    const conn = await getConnection(USER, "azure");

    expect(conn?.accessToken).toBe("fresh-access-token");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("could not store"), "write refused");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("fresh-access-token");
  });

  it("returns null when there is no row", async () => {
    expect(await getConnection(USER, "trello")).toBeNull();
  });

  it("returns null and warns when the database is down", async () => {
    db.failWith = { message: "connection refused" };
    expect(await getConnection(USER, "trello")).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not read the trello connection"),
      "connection refused",
    );
  });
});

describe("when a token is refreshed", () => {
  beforeEach(() => {
    vi.stubEnv("AZURE_DEVOPS_CLIENT_ID", "ado-client");
    vi.stubEnv("AZURE_DEVOPS_CLIENT_SECRET", "ado-secret");
  });

  // A filing can run for five minutes on the token it started with.
  it("refreshes a token with less than ten minutes left", async () => {
    seedExpiringIn("azure", "refresh-1", 9 * 60_000);
    const fetchMock = stubTokenEndpoint(NEW_TOKEN);

    expect((await getConnection(USER, "azure"))?.accessToken).toBe("new");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves a token with more than ten minutes left alone", async () => {
    seedExpiringIn("azure", "refresh-1", 11 * 60_000);
    const fetchMock = stubTokenEndpoint(NEW_TOKEN);

    expect((await getConnection(USER, "azure"))?.accessToken).toBe("old");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps using a token that still has minutes left when its early refresh is refused", async () => {
    seedExpiringIn("azure", "refresh-1", 5 * 60_000);
    const fetchMock = stubTokenEndpoint({ ok: false, status: 503 });

    expect((await getConnection(USER, "azure"))?.accessToken).toBe("old");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up on a token in its last minute when the refresh is refused", async () => {
    seedExpiringIn("azure", "refresh-1", 30_000);
    stubTokenEndpoint({ ok: false, status: 400 });

    expect(await getConnection(USER, "azure")).toBeNull();
  });
});

describe("readConnection tells no row from a row that can't be used", () => {
  it("is absent when the user has no such row, and connected when the token reads", async () => {
    expect(await readConnection(USER, "linear")).toEqual({ state: "absent" });
    await saveConnection(USER, "linear", { accessToken: "lin_tok", meta: { workspaceId: "org-1" } });
    expect(await readConnection(USER, "linear")).toEqual({
      state: "connected",
      connection: { provider: "linear", accessToken: "lin_tok", meta: { workspaceId: "org-1" } },
    });
  });

  it("is unusable, not absent, when the refresh is refused", async () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "gh-client");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "gh-secret");
    seedExpired("github", "ghr_revoked");
    stubTokenEndpoint({ ok: false, status: 400 });
    expect(await readConnection(USER, "github")).toEqual({ state: "unusable" });
    expect(await getConnection(USER, "github")).toBeNull();
  });

  it("is unusable, not absent, when the row won't decrypt or the store is down", async () => {
    await saveConnection(USER, "jira", { accessToken: "ji_tok" });
    vi.stubEnv("CONNECTIONS_KEY", Buffer.alloc(32, 9).toString("base64"));
    expect(await readConnection(USER, "jira")).toEqual({ state: "unusable" });
    vi.stubEnv("CONNECTIONS_KEY", KEY);
    db.failWith = { message: "connection refused" };
    expect(await readConnection(USER, "jira")).toEqual({ state: "unusable" });
  });
});

describe("readConnectionMeta", () => {
  it("reads the meta of an expiring connection without refreshing or decrypting it", async () => {
    seedExpired("azure", "refresh-1");
    const fetchMock = stubTokenEndpoint(NEW_TOKEN);
    // A key that could not decrypt the row: the meta is read all the same.
    vi.stubEnv("CONNECTIONS_KEY", undefined);

    expect(await readConnectionMeta(USER, "azure")).toEqual({ workspaceId: "org-1", label: "Razi" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is null when the user has no such connection, and {} for a row with no meta", async () => {
    expect(await readConnectionMeta(USER, "monday")).toBeNull();
    db.rows.set(`${USER}|monday`, { user_id: USER, provider: "monday", account_meta: null });
    expect(await readConnectionMeta(USER, "monday")).toEqual({});
  });

  it("throws when the database is down, since that is not 'not connected'", async () => {
    db.failWith = { message: "connection refused" };
    await expect(readConnectionMeta(USER, "monday")).rejects.toThrow("connection refused");
  });
});

describe("a refresh in flight", () => {
  beforeEach(() => {
    vi.stubEnv("AZURE_DEVOPS_CLIENT_ID", "ado-client");
    vi.stubEnv("AZURE_DEVOPS_CLIENT_SECRET", "ado-secret");
    seedExpired("azure", "refresh-1");
  });

  it("does not bring back a connection deleted while the token request was pending", async () => {
    const g = gate();
    const fetchMock = stubTokenEndpoint(NEW_TOKEN, g.closed);

    const pending = getConnection(USER, "azure");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await deleteConnection(USER, "azure");
    g.open();
    await pending;

    expect(db.rows.has(`${USER}|azure`)).toBe(false);
  });

  it("keeps a workspace picked while the token request was pending", async () => {
    const g = gate();
    const fetchMock = stubTokenEndpoint(NEW_TOKEN, g.closed);

    const pending = getConnection(USER, "azure");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await setConnectionMeta(USER, "azure", { workspaceId: "org-2", workspaceName: "Other" });
    g.open();
    expect((await pending)?.accessToken).toBe("new");

    const stored = db.rows.get(`${USER}|azure`)!;
    expect(stored.account_meta).toEqual({
      workspaceId: "org-2",
      workspaceName: "Other",
      label: "Razi",
    });
    expect(decryptToken(stored.access_token_enc as string, KEY)).toBe("new");
  });
});

describe("monday refresh (OAuth 2.1)", () => {
  beforeEach(() => {
    vi.stubEnv("MONDAY_CLIENT_ID", "mo-client");
    vi.stubEnv("MONDAY_CLIENT_SECRET", "mo-secret");
  });

  it("refreshes on the OAuth 2.1 endpoint with no scope, and keeps the rotated refresh token", async () => {
    seedExpired("monday", "mo-refresh-1");
    const fetchMock = stubTokenEndpoint({
      ok: true,
      status: 200,
      json: { access_token: "mo-new", refresh_token: "mo-refresh-2", expires_in: 3600 },
    });

    expect((await getConnection(USER, "monday"))?.accessToken).toBe("mo-new");
    expect(fetchMock.mock.calls[0][0]).toBe("https://auth.monday.com/oauth_ms/oauth/token");
    expect(Object.fromEntries(sentBody(fetchMock))).toEqual({
      client_id: "mo-client",
      client_secret: "mo-secret",
      grant_type: "refresh_token",
      refresh_token: "mo-refresh-1",
    });
    // monday revokes the old refresh token on use, so the new one must stick.
    const stored = db.rows.get(`${USER}|monday`)!;
    expect(decryptToken(stored.refresh_token_enc as string, KEY)).toBe("mo-refresh-2");
  });
});

describe("GitLab and Notion refreshes", () => {
  beforeEach(() => {
    vi.stubEnv("GITLAB_CLIENT_ID", "gl-client");
    vi.stubEnv("GITLAB_CLIENT_SECRET", "gl-secret");
    vi.stubEnv("NOTION_CLIENT_ID", "nt-client");
    vi.stubEnv("NOTION_CLIENT_SECRET", "nt-secret");
  });

  it("refreshes GitLab with a form body carrying the redirect URI and no scope, and keeps the rotated token", async () => {
    vi.stubEnv("APP_URL", "https://cloud.example.com/");
    seedExpired("gitlab", "gl-refresh-1");
    const fetchMock = stubTokenEndpoint({
      ok: true,
      status: 200,
      json: { access_token: "gl-new", refresh_token: "gl-refresh-2", expires_in: 7200, created_at: 1 },
    });

    expect((await getConnection(USER, "gitlab"))?.accessToken).toBe("gl-new");
    expect(fetchMock.mock.calls[0][0]).toBe("https://gitlab.com/oauth/token");
    expect(Object.fromEntries(sentBody(fetchMock))).toEqual({
      client_id: "gl-client",
      client_secret: "gl-secret",
      grant_type: "refresh_token",
      refresh_token: "gl-refresh-1",
      redirect_uri: "https://cloud.example.com/api/connect/gitlab/callback",
    });
    // GitLab revoked gl-refresh-1 when it answered, so the new one must stick.
    const stored = db.rows.get(`${USER}|gitlab`)!;
    expect(decryptToken(stored.refresh_token_enc as string, KEY)).toBe("gl-refresh-2");
  });

  it("refreshes GitLab without a redirect URI when there is no APP_URL to build one from", async () => {
    vi.stubEnv("APP_URL", "");
    seedExpired("gitlab", "gl-refresh-1");
    const fetchMock = stubTokenEndpoint(NEW_TOKEN);
    await getConnection(USER, "gitlab");
    expect(sentBody(fetchMock).has("redirect_uri")).toBe(false);
  });

  it("refreshes Notion with Basic auth and a JSON body", async () => {
    seedExpired("notion", "nt-refresh-1");
    const fetchMock = stubTokenEndpoint(NEW_TOKEN);

    expect((await getConnection(USER, "notion"))?.accessToken).toBe("new");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.notion.com/v1/oauth/token");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Basic ${Buffer.from("nt-client:nt-secret").toString("base64")}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ grant_type: "refresh_token", refresh_token: "nt-refresh-1" });
  });
});

describe("Linear, Jira and GitHub refreshes", () => {
  beforeEach(() => {
    vi.stubEnv("LINEAR_CLIENT_ID", "li-client");
    vi.stubEnv("LINEAR_CLIENT_SECRET", "li-secret");
    vi.stubEnv("JIRA_CLIENT_ID", "ji-client");
    vi.stubEnv("JIRA_CLIENT_SECRET", "ji-secret");
    vi.stubEnv("GITHUB_CLIENT_ID", "gh-client");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "gh-secret");
  });

  it("refreshes Linear with a form body and no scope, and keeps the rotated refresh token", async () => {
    seedExpired("linear", "li-refresh-1");
    const fetchMock = stubTokenEndpoint({
      ok: true,
      status: 200,
      json: { access_token: "li-new", refresh_token: "li-refresh-2", expires_in: 86399, scope: "read write" },
    });

    expect((await getConnection(USER, "linear"))?.accessToken).toBe("li-new");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.linear.app/oauth/token");
    expect(new Headers(init.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(sentBody(fetchMock))).toEqual({
      client_id: "li-client",
      client_secret: "li-secret",
      grant_type: "refresh_token",
      refresh_token: "li-refresh-1",
    });
    // Linear rotates the refresh token, so the new one must stick.
    const stored = db.rows.get(`${USER}|linear`)!;
    expect(decryptToken(stored.refresh_token_enc as string, KEY)).toBe("li-refresh-2");
  });

  it("refreshes Jira with the app's credentials inside a JSON body, and keeps the rotated refresh token", async () => {
    seedExpired("jira", "ji-refresh-1");
    const fetchMock = stubTokenEndpoint({
      ok: true,
      status: 200,
      json: { access_token: "ji-new", refresh_token: "ji-refresh-2", expires_in: 3600 },
    });

    expect((await getConnection(USER, "jira"))?.accessToken).toBe("ji-new");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://auth.atlassian.com/oauth/token");
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    // The credentials ride in the body, not in a Basic header.
    expect(headers.has("authorization")).toBe(false);
    expect(JSON.parse(String(init.body))).toEqual({
      client_id: "ji-client",
      client_secret: "ji-secret",
      grant_type: "refresh_token",
      refresh_token: "ji-refresh-1",
    });
    const stored = db.rows.get(`${USER}|jira`)!;
    expect(decryptToken(stored.refresh_token_enc as string, KEY)).toBe("ji-refresh-2");
    // The site picked at connect time is left alone.
    expect(stored.account_meta).toEqual({ workspaceId: "org-1", label: "Razi" });
  });

  it("refreshes GitHub with a form body, asking for JSON back, and keeps the rotated refresh token", async () => {
    seedExpired("github", "ghr_1");
    const fetchMock = stubTokenEndpoint({
      ok: true,
      status: 200,
      json: {
        access_token: "ghu_new",
        refresh_token: "ghr_2",
        expires_in: 28800,
        refresh_token_expires_in: 15811200,
        token_type: "bearer",
      },
    });

    expect((await getConnection(USER, "github"))?.accessToken).toBe("ghu_new");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://github.com/login/oauth/access_token");
    // GitHub answers form-encoded unless asked for JSON.
    expect(new Headers(init.headers).get("accept")).toBe("application/json");
    expect(Object.fromEntries(sentBody(fetchMock))).toEqual({
      client_id: "gh-client",
      client_secret: "gh-secret",
      grant_type: "refresh_token",
      refresh_token: "ghr_1",
    });
    const stored = db.rows.get(`${USER}|github`)!;
    expect(decryptToken(stored.refresh_token_enc as string, KEY)).toBe("ghr_2");
  });

  it("reads GitHub's 200 that carries an error as a refused refresh", async () => {
    seedExpired("github", "ghr_revoked");
    const before = { ...db.rows.get(`${USER}|github`) };
    stubTokenEndpoint({ ok: true, status: 200, json: { error: "bad_refresh_token" } });

    expect(await getConnection(USER, "github")).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("github refused the token refresh: 200"));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("bad_refresh_token");
    expect(db.rows.get(`${USER}|github`)).toEqual(before);
  });

  it("never refreshes a GitHub token that does not expire", async () => {
    await saveConnection(USER, "github", { accessToken: "gho_forever" });
    const fetchMock = stubTokenEndpoint(NEW_TOKEN);

    expect((await getConnection(USER, "github"))?.accessToken).toBe("gho_forever");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("two refreshes racing on one rotating token", () => {
  beforeEach(() => {
    vi.stubEnv("GITLAB_CLIENT_ID", "gl-client");
    vi.stubEnv("GITLAB_CLIENT_SECRET", "gl-secret");
    seedExpired("gitlab", "gl-refresh-1");
  });

  /** What another machine's winning refresh writes while ours is in flight. */
  function storeFromElsewhere(accessToken: string, expiresInMs: number) {
    const row = db.rows.get(`${USER}|gitlab`)!;
    db.rows.set(`${USER}|gitlab`, {
      ...row,
      access_token_enc: encryptToken(accessToken, KEY),
      refresh_token_enc: encryptToken("gl-refresh-2", KEY),
      expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    });
  }

  it("uses the token the winner stored when GitLab refuses the loser", async () => {
    const g = gate();
    const fetchMock = stubTokenEndpoint({ ok: false, status: 400 }, g.closed);

    const pending = getConnection(USER, "gitlab");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    storeFromElsewhere("won-elsewhere", 7200_000);
    g.open();

    expect((await pending)?.accessToken).toBe("won-elsewhere");
    expect(warn).not.toHaveBeenCalled();
    // The winner's row is left exactly as it wrote it.
    const stored = db.rows.get(`${USER}|gitlab`)!;
    expect(decryptToken(stored.refresh_token_enc as string, KEY)).toBe("gl-refresh-2");
  });

  it("still fails when what was stored meanwhile is already expiring", async () => {
    const g = gate();
    const fetchMock = stubTokenEndpoint({ ok: false, status: 400 }, g.closed);

    const pending = getConnection(USER, "gitlab");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    storeFromElsewhere("stale-elsewhere", 30_000);
    g.open();

    expect(await pending).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("gitlab refused the token refresh: 400"));
  });

  it("shares one refresh between callers in this process, so GitLab never sees a revoked token", async () => {
    const g = gate();
    const fetchMock = stubTokenEndpoint(
      { ok: true, status: 200, json: { access_token: "gl-new", refresh_token: "gl-refresh-2", expires_in: 7200 } },
      g.closed,
    );

    const both = Promise.all([getConnection(USER, "gitlab"), getConnection(USER, "gitlab")]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    g.open();

    expect((await both).map((c) => c?.accessToken)).toEqual(["gl-new", "gl-new"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("listConnectedProviders", () => {
  it("lists the user's owned connections", async () => {
    await saveConnection(USER, "asana", { accessToken: "a" });
    await saveConnection("user_2", "trello", { accessToken: "b" });
    expect(await listConnectedProviders(USER)).toEqual(["asana"]);
  });

  it("returns nothing and warns when the database is down", async () => {
    db.failWith = { message: "connection refused" };
    expect(await listConnectedProviders(USER)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not list connections"),
      "connection refused",
    );
  });
});

describe("connectionWorkspace", () => {
  it("falls back to the id for a missing name, and to null before a pick", () => {
    expect(
      connectionWorkspace({ provider: "asana", accessToken: "t", meta: { workspaceId: "42" } }),
    ).toEqual({ id: "42", name: "42" });
    expect(connectionWorkspace({ provider: "asana", accessToken: "t", meta: {} })).toBeNull();
  });
});

describe("isProviderConfigured", () => {
  it("is false without CONNECTIONS_KEY, even with the app credentials", () => {
    vi.stubEnv("CONNECTIONS_KEY", undefined);
    vi.stubEnv("TRELLO_API_KEY", "trello-key");
    expect(isProviderConfigured("trello")).toBe(false);
  });

  it("is true for trello with only TRELLO_API_KEY, since it never exchanges a code", () => {
    vi.stubEnv("TRELLO_API_KEY", "trello-key");
    vi.stubEnv("TRELLO_API_SECRET", undefined);
    expect(isProviderConfigured("trello")).toBe(true);
  });

  it.each([
    ["linear", "LINEAR_CLIENT_ID", "LINEAR_CLIENT_SECRET"],
    ["jira", "JIRA_CLIENT_ID", "JIRA_CLIENT_SECRET"],
    ["github", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
    ["gitlab", "GITLAB_CLIENT_ID", "GITLAB_CLIENT_SECRET"],
    ["notion", "NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET"],
  ] as const)("needs both of %s's client credentials", (provider, id, secret) => {
    vi.stubEnv(id, "client");
    vi.stubEnv(secret, undefined);
    expect(isProviderConfigured(provider)).toBe(false);
    vi.stubEnv(secret, "secret");
    expect(isProviderConfigured(provider)).toBe(true);
  });

  it("is false for monday without MONDAY_CLIENT_SECRET", () => {
    vi.stubEnv("MONDAY_CLIENT_ID", "monday-client");
    vi.stubEnv("MONDAY_CLIENT_SECRET", undefined);
    expect(isProviderConfigured("monday")).toBe(false);
  });

  // Otherwise a bad key looks configured and only fails at the callback, with
  // Node's "Invalid key length".
  it("is false when CONNECTIONS_KEY is not base64 of exactly 32 bytes", () => {
    vi.stubEnv("TRELLO_API_KEY", "trello-key");
    vi.stubEnv("CONNECTIONS_KEY", Buffer.alloc(16, 7).toString("base64"));
    expect(isProviderConfigured("trello")).toBe(false);
    vi.stubEnv("CONNECTIONS_KEY", "not-a-real-key");
    expect(isProviderConfigured("trello")).toBe(false);
  });
});

describe("a malformed CONNECTIONS_KEY", () => {
  it("fails a save loudly and a read quietly, with a warning", async () => {
    await saveConnection(USER, "clickup", { accessToken: "pk_token" });
    vi.stubEnv("CONNECTIONS_KEY", Buffer.alloc(16, 7).toString("base64"));

    await expect(saveConnection(USER, "clickup", { accessToken: "pk_token" })).rejects.toThrow(
      /CONNECTIONS_KEY/,
    );
    expect(await getConnection(USER, "clickup")).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not read the clickup connection"),
      expect.stringContaining("CONNECTIONS_KEY"),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("pk_token");
  });
});

describe("writes report failures", () => {
  it("saveConnection throws when the database reports an error", async () => {
    db.failWith = { message: "boom" };
    await expect(saveConnection(USER, "monday", { accessToken: "tok" })).rejects.toThrow("boom");
  });

  it("deleteConnection throws when the database reports an error", async () => {
    db.failWith = { message: "boom" };
    await expect(deleteConnection(USER, "monday")).rejects.toThrow("boom");
  });

  it("deleteOtherConnections throws when the database reports an error", async () => {
    db.failWith = { message: "boom" };
    await expect(deleteOtherConnections(USER, "monday")).rejects.toThrow("boom");
  });
});

describe("setConnectionMeta", () => {
  it("merges into the existing meta without dropping keys", async () => {
    await saveConnection(USER, "trello", {
      accessToken: "trello-token",
      meta: { memberId: "m1", label: "Razi" },
    });

    await setConnectionMeta(USER, "trello", { workspaceId: "w1", workspaceName: "Team" });

    const stored = db.rows.get(`${USER}|trello`)!;
    expect(stored.account_meta).toEqual({
      memberId: "m1",
      label: "Razi",
      workspaceId: "w1",
      workspaceName: "Team",
    });
    // Only the meta moved: the token is still the one that was saved.
    expect(decryptToken(stored.access_token_enc as string, KEY)).toBe("trello-token");
  });

  it("throws when the user has no such connection", async () => {
    await expect(setConnectionMeta(USER, "monday", { workspaceId: "w1" })).rejects.toThrow();
  });
});

describe("deleteOtherConnections", () => {
  it("removes the user's other owned rows only", async () => {
    await saveConnection(USER, "clickup", { accessToken: "a" });
    await saveConnection(USER, "trello", { accessToken: "b" });
    await saveConnection(USER, "azure", { accessToken: "c" });
    await saveConnection(USER, "linear", { accessToken: "e" });
    await saveConnection("user_2", "trello", { accessToken: "d" });

    await deleteOtherConnections(USER, "clickup");

    expect([...db.rows.keys()].sort()).toEqual(["user_1|clickup", "user_2|trello"]);
  });
});
