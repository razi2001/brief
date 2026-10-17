import { createHash, randomBytes } from "crypto";
import { runInNewContext } from "vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Workspace } from "@/lib/tracker";
import type { OwnedProvider } from "@/lib/connections";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const session = vi.hoisted(() => ({ userId: "user_1" as string | null }));

/** The Clerk user's external accounts, which ones the route removed, and failures to inject. */
const clerk = vi.hoisted(() => ({
  accounts: [] as Array<{ id: string; provider: string; imageUrl?: string }>,
  deleted: [] as string[],
  failGetUser: false,
  failDelete: false,
  reads: 0,
  // How the user signs in besides their external accounts: by default an
  // email address they verified with a code, like every Brief user.
  passwordEnabled: false,
  emails: [] as Array<{ verification: { status: string; strategy: string } }>,
  // The profile photo: by default Clerk's own avatar, so none of the user's.
  hasImage: false,
  imageUrl: "",
  failUpload: false,
  // Photo uploads and account deletes, in the order they happened.
  log: [] as string[],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: session.userId }),
  clerkClient: async () => ({
    users: {
      getUser: async () => {
        clerk.reads++;
        if (clerk.failGetUser) throw new Error("clerk down");
        return {
          externalAccounts: clerk.accounts,
          passwordEnabled: clerk.passwordEnabled,
          emailAddresses: clerk.emails,
          hasImage: clerk.hasImage,
          imageUrl: clerk.imageUrl,
        };
      },
      deleteUserExternalAccount: async ({ externalAccountId }: { externalAccountId: string }) => {
        if (clerk.failDelete) throw new Error("clerk refused");
        clerk.deleted.push(externalAccountId);
        clerk.log.push(`delete ${externalAccountId}`);
        return { id: externalAccountId, deleted: true };
      },
      updateUserProfileImage: async (_userId: string, { file }: { file: File }) => {
        if (clerk.failUpload) throw new Error("clerk refused the image");
        clerk.log.push(`photo ${file.type}`);
        // Clerk then shows the upload, as it does.
        clerk.hasImage = true;
        clerk.imageUrl = `https://img.clerk.com/${Buffer.from(JSON.stringify({ type: "upload", src: "u" })).toString("base64url")}`;
        return {};
      },
    },
  }),
}));

/**
 * A tracker_connections table holding token columns, so a route that selected
 * them would leak them, and a record of org_members deletes.
 */
const db = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  orgDeletes: [] as string[],
  selects: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      if (table === "org_members") {
        return {
          delete: () => ({
            eq: async (_col: string, userId: string) => {
              db.orgDeletes.push(userId);
              return { error: null };
            },
          }),
        };
      }
      if (table === "tracker_connections") {
        return {
          select: (cols: string) => {
            db.selects.push(cols);
            return {
              eq: async (_col: string, userId: string) => {
                const hits = db.rows.filter((r) => r.user_id === userId);
                const want = cols.split(",").map((c) => c.trim());
                const data = want.includes("*")
                  ? hits
                  : hits.map((r) => Object.fromEntries(want.map((c) => [c, r[c]])));
                return { data, error: null };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

const store = vi.hoisted(() => ({
  saveConnection: vi.fn(async () => {}),
  deleteOtherConnections: vi.fn(async () => {}),
  deleteConnection: vi.fn(async () => {}),
  // The meta of a row the user already has for this provider; null: none.
  readConnectionMeta: vi.fn(async (): Promise<Record<string, string> | null> => null),
}));

// The real specs, provider checks and redirect URI; only the writes are faked.
vi.mock("@/lib/connections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/connections")>()),
  ...store,
}));

/** Mutated in place by a test, so the route sees the same array. */
const registry = vi.hoisted(() => ({ clerk: [] as Array<{ key?: string; clerkMatch?: string }> }));
const CLERK_MATCHES = [
  { key: "linear", clerkMatch: "linear" },
  { key: "jira", clerkMatch: "atlassian" },
  { key: "github", clerkMatch: "github" },
];

vi.mock("@/lib/trackers/registry", () => ({ CLERK_PROVIDERS: registry.clerk }));

const workspaces = vi.hoisted(() => ({
  forgetWorkspaces: vi.fn(),
  // The GitHub org picked for a Clerk connection before the move, or null.
  legacyGithubPick: vi.fn(async (): Promise<Workspace | null> => null),
  forgetLegacyGithubPick: vi.fn(async () => {}),
}));
vi.mock("@/lib/workspaces", () => workspaces);

const lists = vi.hoisted(() => ({
  // Linear's one organization, or null when reading it fails.
  linear: null as Workspace | null,
  // Jira's sites, or null when Atlassian doesn't answer.
  jira: [] as Workspace[] | null,
  github: [] as Array<{ login: string; name: string; avatarUrl?: string }>,
  gitlab: [] as Workspace[],
  azure: [] as Workspace[],
  clickup: [] as Workspace[],
  trello: [] as Workspace[],
  asana: [] as Workspace[],
  monday: [] as Workspace[],
  calls: [] as Array<[string, unknown]>,
}));

vi.mock("@/lib/linear", () => ({
  getLinearOrg: async (tok: unknown) => {
    lists.calls.push(["linear", tok]);
    if (!lists.linear) throw new Error("Linear GraphQL: unreachable");
    return lists.linear;
  },
}));
vi.mock("@/lib/jira", () => ({
  listJiraSites: async (token: string) => {
    lists.calls.push(["jira", token]);
    if (!lists.jira) throw new Error("Atlassian accessible-resources answered 503");
    return lists.jira;
  },
}));
vi.mock("@/lib/github", () => ({
  listGithubOrgs: async (tok: unknown) => {
    lists.calls.push(["github", tok]);
    return lists.github;
  },
}));
vi.mock("@/lib/gitlab", () => ({
  listGitlabGroups: async (tok: unknown) => {
    lists.calls.push(["gitlab", tok]);
    return lists.gitlab;
  },
}));
vi.mock("@/lib/azure", () => ({
  listAzureOrgs: async (authorization: string) => {
    lists.calls.push(["azure", authorization]);
    return lists.azure;
  },
}));
vi.mock("@/lib/clickup", () => ({
  clickupAuthHeader: (t: string) => `Bearer ${t}`,
  listClickUpWorkspaces: async (token: string) => {
    lists.calls.push(["clickup", token]);
    return lists.clickup;
  },
}));
vi.mock("@/lib/trello", () => ({
  listTrelloWorkspaces: async (tok: unknown) => {
    lists.calls.push(["trello", tok]);
    return lists.trello;
  },
}));
vi.mock("@/lib/asana", () => ({
  listAsanaWorkspaces: async (token: string) => {
    lists.calls.push(["asana", token]);
    return lists.asana;
  },
}));
vi.mock("@/lib/monday", () => ({
  listMondayAccount: async (tok: unknown) => {
    lists.calls.push(["monday", tok]);
    return lists.monday;
  },
}));

import { GET as start } from "./[provider]/start/route";
import { GET as callback, POST as relayPost } from "./[provider]/callback/route";
import { POST as disconnect } from "./[provider]/disconnect/route";
import { GET as myConnections } from "../me/connections/route";
import { readState } from "@/lib/oauth-state";
import {
  ERROR_COOKIE,
  FLOW_COOKIE,
  errorCookie,
  flowCookie,
  newFlow,
  pkceChallenge,
  readErrorCookie,
  signFlowState,
} from "@/lib/connect-flow";
import { BRIEF_REASON, type ConnectFailure } from "@/lib/connect-errors";

// ---------------------------------------------------------------------------
// Fake provider APIs
// ---------------------------------------------------------------------------

type Call = { url: string; init?: RequestInit };
let fetchCalls: Call[] = [];
/** What each token endpoint answers; a number is an error status. */
let tokenReply: Record<string, unknown> | number = {};
/** The body of a token endpoint's error status. */
let tokenErrorBody: unknown = { error: "invalid_grant" };
/** Whether Trello's members/me answers. */
let trelloMeOk = true;
/** What Azure DevOps' account listing answers: its status, and its organizations. */
let azureAccounts: { status: number; names: string[] } = { status: 200, names: [] };
/** The GitHub account's photo, when it has one, and whether its host is down. */
let githubPhoto: { url: string; down?: boolean } | null = null;
/** Photos Clerk's image proxy serves: a Clerk account's own. */
let clerkPhotos = new Set<string>();

const TOKEN_HOSTS = [
  "api.linear.app/oauth/token",
  "auth.atlassian.com/oauth/token",
  "github.com/login/oauth/access_token",
  "gitlab.com/oauth/token",
  "login.microsoftonline.com",
  "api.clickup.com/api/v2/oauth/token",
  "api.notion.com/v1/oauth/token",
  "app.asana.com/-/oauth_token",
  "auth.monday.com/oauth_ms/oauth/token",
];

function fakeFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const u = String(url);
  fetchCalls.push({ url: u, init });
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  if (TOKEN_HOSTS.some((h) => u.includes(h))) {
    return typeof tokenReply === "number" ? json(tokenErrorBody, tokenReply) : json(tokenReply);
  }
  if (u === "https://api.linear.app/graphql") return json({ data: { viewer: { name: "Ada Linear", displayName: "ada" } } });
  if (u === "https://api.github.com/user") {
    return json({ name: null, login: "ada-gh", ...(githubPhoto ? { avatar_url: githubPhoto.url } : {}) });
  }
  if (githubPhoto && u === githubPhoto.url) {
    if (githubPhoto.down) return Promise.reject(new TypeError("fetch failed"));
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    return Promise.resolve(new Response(png, { status: 200, headers: { "Content-Type": "image/png" } }));
  }
  if (clerkPhotos.has(u)) {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);
    return Promise.resolve(new Response(png, { status: 200, headers: { "Content-Type": "image/png" } }));
  }
  if (u === "https://gitlab.com/api/v4/user") return json({ name: "Ada GitLab", username: "adagl" });
  if (u.includes("vssps.visualstudio.com/_apis/profile")) return json({ id: "member-1", displayName: "Ada Lovelace" });
  if (u.includes("vssps.visualstudio.com/_apis/accounts")) {
    const { status, names } = azureAccounts;
    return json({ count: names.length, value: names.map((accountName) => ({ accountName })) }, status);
  }
  if (u.includes("api.clickup.com/api/v2/user")) return json({ user: { username: "ada", email: "ada@example.com" } });
  if (u.includes("api.trello.com/1/members/me")) {
    return trelloMeOk ? json({ id: "member_1", fullName: "Ada L", username: "adal" }) : json({}, 401);
  }
  if (u.includes("api.monday.com/v2")) return json({ data: { me: { name: "Ada M", email: "ada@m.example" } } });
  return json({ error: "unexpected url" }, 404);
}

function tokenCall(): { url: URL; body: URLSearchParams; init?: RequestInit } {
  const c = fetchCalls.find((f) => TOKEN_HOSTS.some((h) => f.url.includes(h)));
  if (!c) throw new Error("no token request was made");
  return { url: new URL(c.url), body: new URLSearchParams(c.init?.body ? String(c.init.body) : ""), init: c.init };
}

/** A token request's headers, whatever form the route passed them in. */
function tokenHeaders(): Headers {
  return new Headers(tokenCall().init?.headers);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORIGIN = "http://localhost:3000";
const ctx = (provider: string) => ({ params: Promise.resolve({ provider }) });

function get(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`${ORIGIN}${path}`, { headers });
}

function location(res: Response): URL {
  const loc = res.headers.get("location");
  if (!loc) throw new Error(`no redirect (status ${res.status})`);
  return new URL(loc);
}

/** The `name=value` pair of the flow cookie a response sets, as a browser would send it back. */
function flowCookieFrom(res: Response): string | null {
  const c = res.headers.getSetCookie().find((s) => s.startsWith(`${FLOW_COOKIE}=`));
  return c ? c.split(";")[0] : null;
}

function clearsFlowCookie(res: Response): boolean {
  return res.headers.getSetCookie().some((s) => s.startsWith(`${FLOW_COOKIE}=;`) && s.includes("Max-Age=0"));
}

/** The error cookie a response sets, as its Set-Cookie line, or null. */
function errorCookieSet(res: Response): string | null {
  return res.headers.getSetCookie().find((s) => s.startsWith(`${ERROR_COOKIE}=`) && !s.includes("Max-Age=0")) ?? null;
}

/** The failure in the error cookie a response sets, read back as /api/me/connections would. */
function recorded(res: Response, userId = "user_1"): ConnectFailure | null {
  const set = errorCookieSet(res);
  if (!set) return null;
  return readErrorCookie(get("/api/me/connections", { cookie: set.split(";")[0] }), userId);
}

/** A GET of /api/me/connections, carrying an error cookie when given one. */
function meReq(cookie?: string) {
  return get("/api/me/connections", cookie ? { cookie } : {});
}

/** Run the real start route and return what the browser would carry to the callback. */
async function startFlow(provider: OwnedProvider, returnTo = "/connections") {
  const res = await start(get(`/api/connect/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`), ctx(provider));
  const url = location(res);
  const state =
    provider === "trello"
      ? new URL(url.searchParams.get("return_url")!).searchParams.get("state")!
      : url.searchParams.get("state")!;
  const cookie = flowCookieFrom(res);
  if (!cookie) throw new Error("start set no flow cookie");
  return { res, url, state, cookie };
}

/** A hand-made state and the cookie that matches (or, with `nonce`, does not). */
function flowFor(
  provider: OwnedProvider,
  over: Partial<{ userId: string; returnTo: string; stateProvider: OwnedProvider; nonce: string }> = {},
) {
  const flow = newFlow(provider);
  const state = signFlowState({
    userId: over.userId ?? "user_1",
    provider: over.stateProvider ?? provider,
    returnTo: over.returnTo ?? "/connections",
    nonce: over.nonce ?? flow.nonce,
  });
  return { flow, state, cookie: flowCookie(flow, false).split(";")[0] };
}

function callbackReq(provider: string, params: Record<string, string>, cookie?: string) {
  const qs = new URLSearchParams(params).toString();
  return get(`/api/connect/${provider}/callback?${qs}`, cookie ? { cookie } : {});
}

async function runCallback(provider: OwnedProvider, returnTo = "/connections", params: Record<string, string> = {}) {
  const { state, cookie } = await startFlow(provider, returnTo);
  fetchCalls = [];
  return callback(callbackReq(provider, { code: "code-123", state, ...params }, cookie), ctx(provider));
}

function relayReq(
  body: unknown,
  opts: Partial<{ cookie: string; origin: string | null; contentType: string | null; provider: string; site: string }> = {},
) {
  const headers: Record<string, string> = {};
  const contentType = opts.contentType === undefined ? "application/json" : opts.contentType;
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (contentType) headers["content-type"] = contentType;
  if (origin) headers.origin = origin;
  if (opts.site) headers["sec-fetch-site"] = opts.site;
  if (opts.cookie) headers.cookie = opts.cookie;
  return new NextRequest(`${ORIGIN}/api/connect/${opts.provider ?? "trello"}/callback`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** What Entra sent back to a user whose tenant had never used Azure DevOps. */
const AADSTS650052 =
  "AADSTS650052: The app is trying to access a service '499b84ac-1321-427f-aa17-267ca6975798'(Azure DevOps) " +
  "that your organization 'a1b2c3d4-0000-4000-8000-000000000000' lacks a service principal for. Contact your IT " +
  "Admin to review the configuration of your service subscriptions or consent to the application in order to " +
  "create the required service principal.\r\nTrace ID: 0f0e0d0c-1111-2222-3333-444455556666\r\nCorrelation ID: " +
  "9a8b7c6d-1111-2222-3333-444455556666\r\nTimestamp: 2026-10-14 09:12:44Z";

type Saved = [string, string, { meta: Record<string, string> }];
const savedMeta = () => (store.saveConnection.mock.calls[0] as unknown as Saved)[2].meta;

const ENV = {
  CONNECTIONS_KEY: randomBytes(32).toString("base64"),
  LINEAR_CLIENT_ID: "li-client",
  LINEAR_CLIENT_SECRET: "li-secret-value",
  JIRA_CLIENT_ID: "ji-client",
  JIRA_CLIENT_SECRET: "ji-secret-value",
  GITHUB_CLIENT_ID: "gh-client",
  GITHUB_CLIENT_SECRET: "gh-secret-value",
  GITLAB_CLIENT_ID: "gl-client",
  GITLAB_CLIENT_SECRET: "gl-secret-value",
  NOTION_CLIENT_ID: "nt-client",
  NOTION_CLIENT_SECRET: "nt-secret-value",
  AZURE_DEVOPS_CLIENT_ID: "az-client",
  AZURE_DEVOPS_CLIENT_SECRET: "az-secret-value",
  CLICKUP_CLIENT_ID: "cu-client",
  CLICKUP_CLIENT_SECRET: "cu-secret-value",
  TRELLO_API_KEY: "trello-key",
  ASANA_CLIENT_ID: "as-client",
  ASANA_CLIENT_SECRET: "as-secret-value",
  MONDAY_CLIENT_ID: "mo-client",
  MONDAY_CLIENT_SECRET: "mo-secret-value",
};

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.stubEnv("APP_URL", "");
  vi.stubEnv("ASANA_SCOPES", "");
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  session.userId = "user_1";
  clerk.accounts = [];
  clerk.deleted = [];
  clerk.failGetUser = false;
  clerk.failDelete = false;
  clerk.reads = 0;
  clerk.passwordEnabled = false;
  clerk.emails = [{ verification: { status: "verified", strategy: "email_code" } }];
  clerk.hasImage = false;
  clerk.imageUrl = "";
  clerk.failUpload = false;
  clerk.log = [];
  githubPhoto = null;
  clerkPhotos = new Set();
  registry.clerk.splice(0, registry.clerk.length, ...CLERK_MATCHES.map((d) => ({ ...d })));
  db.rows = [];
  db.orgDeletes = [];
  db.selects = [];
  for (const k of ["gitlab", "azure", "clickup", "trello", "asana", "monday"] as const) lists[k] = [];
  lists.linear = { id: "lin-org-1", name: "Acme Linear" };
  lists.jira = [];
  lists.github = [];
  lists.calls = [];
  fetchCalls = [];
  trelloMeOk = true;
  azureAccounts = { status: 200, names: [] };
  tokenReply = { access_token: "at_new", refresh_token: "rt_new", expires_in: 3600 };
  tokenErrorBody = { error: "invalid_grant" };
  for (const fn of [store.saveConnection, store.deleteOtherConnections, store.deleteConnection]) {
    fn.mockReset();
    fn.mockImplementation(async () => {});
  }
  store.readConnectionMeta.mockReset();
  store.readConnectionMeta.mockImplementation(async () => null);
  workspaces.forgetWorkspaces.mockReset();
  workspaces.legacyGithubPick.mockReset();
  workspaces.legacyGithubPick.mockImplementation(async () => null);
  workspaces.forgetLegacyGithubPick.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

describe("start", () => {
  it("redirects to the authorize URL with the client id, redirect URI, a signed state and a flow cookie", async () => {
    const { res, url, state, cookie } = await startFlow("azure", "/onboarding");
    expect(res.status).toBe(302);
    expect(`${url.origin}${url.pathname}`).toBe("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
    expect(url.searchParams.get("client_id")).toBe("az-client");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/connect/azure/callback`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("prompt")).toBe("select_account");

    // The state carries the nonce the cookie holds, and the cookie is
    // httpOnly, Lax and only sent to the connect routes.
    const [nonce, verifier] = cookie.slice(FLOW_COOKIE.length + 1).split(".");
    expect(readState(state)).toMatchObject({ userId: "user_1", provider: "azure", returnTo: "/onboarding", nonce });
    const set = res.headers.getSetCookie()[0];
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Path=/api/connect");
    expect(set).not.toContain("Secure");

    // PKCE: the challenge is in the URL, the verifier only in the cookie.
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge(verifier));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.toString()).not.toContain(verifier);
  });

  it("sets a Secure cookie when the app is served over https", async () => {
    vi.stubEnv("APP_URL", "https://cloud.example.com");
    const res = await start(get("/api/connect/clickup/start"), ctx("clickup"));
    expect(res.headers.getSetCookie()[0]).toContain("Secure");
  });

  it("sends no scope when the provider takes none", async () => {
    const { url } = await startFlow("clickup");
    expect(url.origin + url.pathname).toBe("https://app.clickup.com/api");
    expect(url.searchParams.has("scope")).toBe(false);
    expect(url.searchParams.get("client_id")).toBe("cu-client");
    expect(url.searchParams.has("prompt")).toBe(false);
  });

  it("sends GitLab its client id, the api and read_user scopes, and a PKCE challenge", async () => {
    const { url, state, cookie } = await startFlow("gitlab");
    expect(url.origin + url.pathname).toBe("https://gitlab.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("gl-client");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/connect/gitlab/callback`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("api read_user");
    expect(readState(state)).toMatchObject({ userId: "user_1", provider: "gitlab" });

    const verifier = cookie.split(".")[1];
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge(verifier));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.toString()).not.toContain(verifier);
  });

  it("sends Notion owner=user, with no scope and no PKCE", async () => {
    const { url, state } = await startFlow("notion");
    expect(url.origin + url.pathname).toBe("https://api.notion.com/v1/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("nt-client");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/connect/notion/callback`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("owner")).toBe("user");
    expect(url.searchParams.has("scope")).toBe(false);
    expect(url.searchParams.has("code_challenge")).toBe(false);
    expect(readState(state)).toMatchObject({ userId: "user_1", provider: "notion" });
  });

  it("sends Linear its comma-separated scopes, a consent prompt and a PKCE challenge", async () => {
    const { url, state, cookie } = await startFlow("linear");
    expect(url.origin + url.pathname).toBe("https://linear.app/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("li-client");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/connect/linear/callback`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("read,write");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(readState(state)).toMatchObject({ userId: "user_1", provider: "linear" });
    const verifier = cookie.split(".")[1];
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge(verifier));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("sends Atlassian the API audience, its consent prompt and the Jira scopes, with no PKCE", async () => {
    const { url, state } = await startFlow("jira");
    expect(url.origin + url.pathname).toBe("https://auth.atlassian.com/authorize");
    expect(url.searchParams.get("client_id")).toBe("ji-client");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/connect/jira/callback`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("audience")).toBe("api.atlassian.com");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toBe("read:jira-work write:jira-work read:jira-user offline_access");
    expect(url.searchParams.has("code_challenge")).toBe(false);
    expect(readState(state)).toMatchObject({ userId: "user_1", provider: "jira" });
  });

  it("sends GitHub the repo and read:user scopes with a PKCE challenge", async () => {
    const { url, state } = await startFlow("github");
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("gh-client");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/connect/github/callback`);
    expect(url.searchParams.get("scope")).toBe("repo read:user");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(readState(state)).toMatchObject({ userId: "user_1", provider: "github" });
  });

  it.each([
    ["linear", true],
    ["jira", false],
    ["github", true],
    ["gitlab", true],
    ["azure", true],
    ["asana", true],
    ["clickup", false],
    ["notion", false],
    ["monday", true],
    ["trello", false],
  ] as const)("sends a PKCE challenge for %s: %s", async (provider, pkce) => {
    const { url, cookie } = await startFlow(provider);
    expect(url.searchParams.has("code_challenge")).toBe(pkce);
    expect(cookie.includes(".")).toBe(pkce);
  });

  it("builds the redirect URI from APP_URL's origin, and the callback exchanges with that exact string", async () => {
    vi.stubEnv("APP_URL", "https://cloud.example.com/app//");
    const { url, state, cookie } = await startFlow("asana");
    const redirect = url.searchParams.get("redirect_uri");
    expect(redirect).toBe("https://cloud.example.com/api/connect/asana/callback");
    expect(url.searchParams.has("scope")).toBe(false);

    lists.asana = [{ id: "ws1", name: "Acme" }];
    await callback(callbackReq("asana", { code: "c1", state }, cookie), ctx("asana"));
    expect(tokenCall().body.get("redirect_uri")).toBe(redirect);
  });

  it("sends Trello its key and a return URL carrying the state, since it has no state parameter", async () => {
    const { url, state } = await startFlow("trello");
    expect(url.origin + url.pathname).toBe("https://trello.com/1/authorize");
    expect(url.searchParams.get("key")).toBe("trello-key");
    expect(url.searchParams.has("client_id")).toBe(false);
    expect(url.searchParams.has("state")).toBe(false);
    expect(url.searchParams.get("callback_method")).toBe("fragment");
    expect(url.searchParams.get("response_type")).toBe("token");
    const back = new URL(url.searchParams.get("return_url")!);
    expect(back.origin + back.pathname).toBe(`${ORIGIN}/api/connect/trello/callback`);
    expect(readState(state)).toMatchObject({ userId: "user_1", provider: "trello" });
  });

  it("refuses an unknown provider", async () => {
    const res = await start(get("/api/connect/bitbucket/start"), ctx("bitbucket"));
    expect(res.status).toBe(404);
  });

  it.each(["linear", "jira", "github"] as const)(
    "sends %s back with `unavailable` before its OAuth app exists here",
    async (provider) => {
      vi.stubEnv(`${provider.toUpperCase()}_CLIENT_SECRET`, "");
      const url = location(await start(get(`/api/connect/${provider}/start`), ctx(provider)));
      expect(url.origin + url.pathname).toBe(`${ORIGIN}/connections`);
      expect(url.searchParams.get("error")).toBe("unavailable");
    },
  );

  it("sends the browser back with `unavailable` when the provider is not configured", async () => {
    vi.stubEnv("CLICKUP_CLIENT_ID", "");
    const res = await start(get("/api/connect/clickup/start?returnTo=/onboarding"), ctx("clickup"));
    const url = location(res);
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/onboarding`);
    expect(url.searchParams.get("error")).toBe("unavailable");
    expect(url.searchParams.get("provider")).toBe("clickup");
    expect(flowCookieFrom(res)).toBeNull();
  });

  it("treats a missing encryption key as not configured", async () => {
    vi.stubEnv("CONNECTIONS_KEY", "too-short");
    const url = location(await start(get("/api/connect/azure/start"), ctx("azure")));
    expect(url.origin).toBe(ORIGIN);
    expect(url.searchParams.get("error")).toBe("unavailable");
  });

  it("requires a signed-in user", async () => {
    session.userId = null;
    const res = await start(get("/api/connect/azure/start"), ctx("azure"));
    expect(res.status).toBe(401);
  });

  it("refuses a cross-site navigation, sending the browser to Connections", async () => {
    const res = await start(get("/api/connect/azure/start", { "sec-fetch-site": "cross-site" }), ctx("azure"));
    expect(location(res).toString()).toBe(`${ORIGIN}/connections`);
    expect(flowCookieFrom(res)).toBeNull();
  });

  // same-site: Clerk's session handshake runs on clerk.<domain> and sends the
  // browser back to the start route from there.
  it.each(["none", "same-origin", "same-site"])("accepts a %s navigation", async (site) => {
    const res = await start(get("/api/connect/azure/start", { "sec-fetch-site": site }), ctx("azure"));
    expect(location(res).hostname).toBe("login.microsoftonline.com");
  });

  const OFF_SITE = [
    "//evil.example",
    "https://evil.example/x",
    "/\\evil.example",
    "/.//evil.example",
    "/..//evil.example",
    "/%2e//evil.example",
    "/x/..//evil.example",
    "connections",
  ];

  it.each(OFF_SITE)("keeps returnTo on this origin (%s)", async (returnTo) => {
    const { state } = await startFlow("azure", returnTo);
    expect(readState(state)?.returnTo).toBe("/connections");
  });

  it.each(OFF_SITE)("keeps the unconfigured redirect on this origin (%s)", async (returnTo) => {
    vi.stubEnv("CLICKUP_CLIENT_ID", "");
    const qs = new URLSearchParams({ returnTo }).toString();
    const url = location(await start(get(`/api/connect/clickup/start?${qs}`), ctx("clickup")));
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/connections");
  });
});

// ---------------------------------------------------------------------------
// callback
// ---------------------------------------------------------------------------

describe("callback", () => {
  it.each([
    ["garbage", () => ({ ...flowFor("azure"), state: "not-a-state" })],
    ["another user's", () => flowFor("azure", { userId: "user_2" })],
    ["another provider's", () => flowFor("azure", { stateProvider: "clickup" })],
    ["another browser's", () => flowFor("azure", { nonce: "someone-elses-nonce" })],
  ])("refuses %s state, landing on Connections, and stores nothing", async (_label, make) => {
    const { state, cookie } = make();
    const res = await callback(callbackReq("azure", { code: "c1", state }, cookie), ctx("azure"));
    expect(location(res).toString()).toBe(`${ORIGIN}/connections?error=failed&provider=azure`);
    expect(fetchCalls).toHaveLength(0);
    expect(store.saveConnection).not.toHaveBeenCalled();
    // A forged callback must not cancel the real flow in this browser.
    expect(clearsFlowCookie(res)).toBe(false);
  });

  it("refuses a valid state that arrives without the flow cookie", async () => {
    const { state } = await startFlow("azure");
    const res = await callback(callbackReq("azure", { code: "c1", state }), ctx("azure"));
    expect(location(res).searchParams.get("error")).toBe("failed");
    expect(store.saveConnection).not.toHaveBeenCalled();
  });

  it("refuses an expired state the same way", async () => {
    const { state, cookie } = await startFlow("azure", "/onboarding");
    vi.useFakeTimers({ now: Date.now() + 16 * 60_000 });
    try {
      const res = await callback(callbackReq("azure", { code: "c1", state }, cookie), ctx("azure"));
      expect(location(res).toString()).toBe(`${ORIGIN}/connections?error=failed&provider=azure`);
      expect(store.saveConnection).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("exchanges the code with the PKCE verifier and saves the connection with its single workspace", async () => {
    lists.azure = [{ id: "contoso", name: "contoso" }];
    const { state, cookie } = await startFlow("azure", "/onboarding");
    const verifier = cookie.split(".")[1];
    const res = await callback(callbackReq("azure", { code: "code-123", state }, cookie), ctx("azure"));

    const url = location(res);
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/onboarding`);
    expect(url.searchParams.get("connected")).toBe("azure");
    // Single use: the flow cookie is cleared.
    expect(clearsFlowCookie(res)).toBe(true);

    const { body } = tokenCall();
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-123");
    expect(body.get("client_id")).toBe("az-client");
    expect(body.get("client_secret")).toBe("az-secret-value");
    expect(body.get("redirect_uri")).toBe(`${ORIGIN}/api/connect/azure/callback`);
    expect(body.get("code_verifier")).toBe(verifier);
    expect(lists.calls).toContainEqual(["azure", "Bearer at_new"]);

    expect(store.saveConnection).toHaveBeenCalledWith("user_1", "azure", {
      accessToken: "at_new",
      refreshToken: "rt_new",
      expiresInSeconds: 3600,
      meta: { label: "Ada Lovelace", workspaceId: "contoso", workspaceName: "contoso" },
    });
    expect(store.deleteOtherConnections).toHaveBeenCalledWith("user_1", "azure");
    expect(db.orgDeletes).toEqual(["user_1"]);
  });

  it("sends ClickUp's client id, secret and code as a form body, with no PKCE", async () => {
    tokenReply = { access_token: "cu_tok" };
    lists.clickup = [{ id: "9001", name: "Acme" }];
    await runCallback("clickup");

    const { url, init, body } = tokenCall();
    expect(init?.method).toBe("POST");
    expect(url.toString()).toBe("https://api.clickup.com/api/v2/oauth/token");
    expect(Object.fromEntries(body)).toEqual({
      client_id: "cu-client",
      client_secret: "cu-secret-value",
      code: "code-123",
    });
    expect(store.saveConnection).toHaveBeenCalledWith("user_1", "clickup", {
      accessToken: "cu_tok",
      refreshToken: undefined,
      expiresInSeconds: undefined,
      meta: { label: "ada", workspaceId: "9001", workspaceName: "Acme" },
    });
  });

  it("takes Asana's account name from the token reply and sends its PKCE verifier", async () => {
    tokenReply = {
      access_token: "as_tok",
      refresh_token: "as_rt",
      expires_in: 3600,
      data: { id: 42, name: "Ada Asana", email: "ada@asana.example" },
    };
    lists.asana = [{ id: "ws1", name: "Acme" }];
    await runCallback("asana");

    const { body } = tokenCall();
    expect(body.has("scope")).toBe(false);
    expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.saveConnection).toHaveBeenCalledWith("user_1", "asana", {
      accessToken: "as_tok",
      refreshToken: "as_rt",
      expiresInSeconds: 3600,
      meta: { label: "Ada Asana", workspaceId: "ws1", workspaceName: "Acme" },
    });
  });

  it("exchanges a Monday code on the OAuth 2.1 endpoint with its PKCE verifier, and keeps the refresh token", async () => {
    tokenReply = { access_token: "mo_tok", token_type: "Bearer", expires_in: 3600, refresh_token: "mo_rt" };
    lists.monday = [{ id: "123", name: "Acme" }];
    await runCallback("monday");

    const { url, init } = tokenCall();
    expect(url.toString()).toBe("https://auth.monday.com/oauth_ms/oauth/token");
    // monday's OAuth 2.1 endpoint takes JSON, credentials in the body.
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    const body = JSON.parse(String(init?.body)) as Record<string, string>;
    expect(body).toMatchObject({
      grant_type: "authorization_code",
      code: "code-123",
      client_id: expect.any(String),
      client_secret: expect.any(String),
      redirect_uri: expect.stringContaining("/api/connect/monday/callback"),
    });
    expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The grant holds the scope; the token request doesn't repeat it.
    expect(body).not.toHaveProperty("scope");
    expect(store.saveConnection).toHaveBeenCalledWith("user_1", "monday", {
      accessToken: "mo_tok",
      refreshToken: "mo_rt",
      expiresInSeconds: 3600,
      meta: { label: "Ada M", workspaceId: "123", workspaceName: "Acme" },
    });
  });

  it("exchanges a GitLab code with a form body and its PKCE verifier, and stores its one group", async () => {
    tokenReply = { access_token: "gl_tok", token_type: "Bearer", expires_in: 7200, refresh_token: "gl_rt", created_at: 1 };
    lists.gitlab = [{ id: "42", name: "Acme" }];
    const { state, cookie } = await startFlow("gitlab", "/onboarding");
    const verifier = cookie.split(".")[1];
    fetchCalls = [];
    const res = await callback(callbackReq("gitlab", { code: "code-123", state }, cookie), ctx("gitlab"));

    const url = location(res);
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/onboarding`);
    expect(url.searchParams.get("connected")).toBe("gitlab");

    const { url: tokenUrl, body, init } = tokenCall();
    expect(init?.method).toBe("POST");
    expect(tokenUrl.toString()).toBe("https://gitlab.com/oauth/token");
    expect(tokenHeaders().get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(tokenHeaders().has("authorization")).toBe(false);
    // Exactly GitLab's documented fields: the scope stays with the grant.
    expect(Object.fromEntries(body)).toEqual({
      client_id: "gl-client",
      client_secret: "gl-secret-value",
      grant_type: "authorization_code",
      code: "code-123",
      redirect_uri: `${ORIGIN}/api/connect/gitlab/callback`,
      code_verifier: verifier,
    });

    // The groups are listed, and the profile read, with the new token.
    expect(lists.calls).toContainEqual(["gitlab", { token: "gl_tok" }]);
    const me = fetchCalls.find((c) => c.url === "https://gitlab.com/api/v4/user");
    expect(new Headers(me?.init?.headers).get("authorization")).toBe("Bearer gl_tok");

    expect(store.saveConnection).toHaveBeenCalledWith("user_1", "gitlab", {
      accessToken: "gl_tok",
      refreshToken: "gl_rt",
      expiresInSeconds: 7200,
      meta: { label: "Ada GitLab", workspaceId: "42", workspaceName: "Acme" },
    });
    expect(store.deleteOtherConnections).toHaveBeenCalledWith("user_1", "gitlab");
  });

  it("refuses a GitLab callback whose flow cookie lost its verifier", async () => {
    const { state, cookie } = await startFlow("gitlab");
    const res = await callback(callbackReq("gitlab", { code: "c1", state }, cookie.split(".")[0]), ctx("gitlab"));
    expect(location(res).searchParams.get("error")).toBe("failed");
    expect(fetchCalls.some((c) => c.url.includes("gitlab.com/oauth/token"))).toBe(false);
    expect(store.saveConnection).not.toHaveBeenCalled();
  });

  it("sends a GitLab user in several groups to pick one", async () => {
    lists.gitlab = [
      { id: "1", name: "Acme" },
      { id: "2", name: "Side project" },
    ];
    const url = location(await runCallback("gitlab", "/onboarding"));
    expect(url.toString()).toBe(`${ORIGIN}/connections?pick=gitlab`);
    expect(savedMeta()).not.toHaveProperty("workspaceId");
  });

  it("stores GitLab without a group when it is in none, since personal projects still file", async () => {
    lists.gitlab = [];
    const url = location(await runCallback("gitlab"));
    expect(url.searchParams.get("connected")).toBe("gitlab");
    expect(savedMeta()).toEqual({ label: "Ada GitLab" });
  });

  it("exchanges a Linear code with a form body and its PKCE verifier, and stores its one workspace", async () => {
    tokenReply = { access_token: "lin_tok", token_type: "Bearer", expires_in: 86399, refresh_token: "lin_rt", scope: "read write" };
    const { state, cookie } = await startFlow("linear", "/onboarding");
    const verifier = cookie.split(".")[1];
    fetchCalls = [];
    const res = await callback(callbackReq("linear", { code: "code-123", state }, cookie), ctx("linear"));

    const url = location(res);
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/onboarding`);
    expect(url.searchParams.get("connected")).toBe("linear");

    const { url: tokenUrl, body } = tokenCall();
    expect(tokenUrl.toString()).toBe("https://api.linear.app/oauth/token");
    expect(tokenHeaders().get("content-type")).toBe("application/x-www-form-urlencoded");
    // Linear's documented fields; the scope stays with the grant.
    expect(Object.fromEntries(body)).toEqual({
      client_id: "li-client",
      client_secret: "li-secret-value",
      grant_type: "authorization_code",
      code: "code-123",
      redirect_uri: `${ORIGIN}/api/connect/linear/callback`,
      code_verifier: verifier,
    });

    // The org and the viewer are read with the new token.
    expect(lists.calls).toContainEqual(["linear", { token: "lin_tok" }]);
    const viewer = fetchCalls.find((c) => c.url === "https://api.linear.app/graphql");
    expect(new Headers(viewer?.init?.headers).get("authorization")).toBe("Bearer lin_tok");

    expect(store.saveConnection).toHaveBeenCalledWith("user_1", "linear", {
      accessToken: "lin_tok",
      refreshToken: "lin_rt",
      expiresInSeconds: 86399,
      meta: { label: "Ada Linear", workspaceId: "lin-org-1", workspaceName: "Acme Linear" },
    });
    expect(store.deleteOtherConnections).toHaveBeenCalledWith("user_1", "linear");
  });

  it("still connects Linear when its organization can't be read, since filing doesn't need it", async () => {
    lists.linear = null;
    const url = location(await runCallback("linear"));
    expect(url.searchParams.get("connected")).toBe("linear");
    expect(savedMeta()).toEqual({ label: "Ada Linear" });
  });

  it("moves a user's Linear from Clerk to Brief: the Clerk Linear account goes, sign-in ones stay", async () => {
    clerk.accounts = [
      { id: "ea_google", provider: "oauth_google" },
      { id: "ea_linear", provider: "oauth_linear" },
    ];
    const url = location(await runCallback("linear"));
    expect(url.searchParams.get("connected")).toBe("linear");
    expect(clerk.deleted).toEqual(["ea_linear"]);
  });

  it("exchanges a Jira code with the app's credentials in a JSON body, and stores its one site with the site's address", async () => {
    tokenReply = { access_token: "ji_tok", refresh_token: "ji_rt", expires_in: 3600, scope: "read:jira-work" };
    lists.jira = [{ id: "cloud-1", name: "acme", url: "https://acme.atlassian.net" }];
    const res = await runCallback("jira");

    expect(location(res).searchParams.get("connected")).toBe("jira");
    const { url: tokenUrl, init } = tokenCall();
    expect(tokenUrl.toString()).toBe("https://auth.atlassian.com/oauth/token");
    expect(tokenHeaders().get("content-type")).toBe("application/json");
    expect(tokenHeaders().has("authorization")).toBe(false);
    // No PKCE and no scope: Atlassian's documented fields only.
    expect(JSON.parse(String(init?.body))).toEqual({
      client_id: "ji-client",
      client_secret: "ji-secret-value",
      grant_type: "authorization_code",
      code: "code-123",
      redirect_uri: `${ORIGIN}/api/connect/jira/callback`,
    });
    expect(lists.calls).toContainEqual(["jira", "ji_tok"]);
    // The site names the card: no Atlassian profile data is kept.
    expect(store.saveConnection).toHaveBeenCalledWith("user_1", "jira", {
      accessToken: "ji_tok",
      refreshToken: "ji_rt",
      expiresInSeconds: 3600,
      meta: { workspaceId: "cloud-1", workspaceName: "acme", siteUrl: "https://acme.atlassian.net" },
    });
  });

  it("sends a Jira user granted several sites to pick one", async () => {
    lists.jira = [
      { id: "cloud-1", name: "acme", url: "https://acme.atlassian.net" },
      { id: "cloud-2", name: "beta", url: "https://beta.atlassian.net" },
    ];
    const url = location(await runCallback("jira", "/onboarding"));
    expect(url.toString()).toBe(`${ORIGIN}/connections?pick=jira`);
    expect(savedMeta()).toEqual({});
  });

  it("does not store Jira without a site, and keeps the current tracker", async () => {
    lists.jira = [];
    clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear" }];
    const url = location(await runCallback("jira"));
    expect(url.searchParams.get("error")).toBe("no_workspace");
    expect(url.searchParams.get("provider")).toBe("jira");
    expect(store.saveConnection).not.toHaveBeenCalled();
    expect(clerk.deleted).toEqual([]);
  });

  it("reports a failed Jira site listing as `failed`, not as no site", async () => {
    lists.jira = null;
    const url = location(await runCallback("jira"));
    expect(url.searchParams.get("error")).toBe("failed");
    expect(store.saveConnection).not.toHaveBeenCalled();
  });

  it("exchanges a GitHub code with its PKCE verifier, asking for JSON, and stores its one org", async () => {
    tokenReply = { access_token: "ghu_tok", token_type: "bearer", scope: "repo,read:user", expires_in: 28800, refresh_token: "ghr_tok" };
    lists.github = [{ login: "Acme", name: "Acme", avatarUrl: "https://avatars.test/acme" }];
    const { state, cookie } = await startFlow("github");
    const verifier = cookie.split(".")[1];
    fetchCalls = [];
    const res = await callback(callbackReq("github", { code: "code-123", state }, cookie), ctx("github"));

    expect(location(res).searchParams.get("connected")).toBe("github");
    const { url: tokenUrl, body } = tokenCall();
    expect(tokenUrl.toString()).toBe("https://github.com/login/oauth/access_token");
    // GitHub answers form-encoded unless asked for JSON.
    expect(tokenHeaders().get("accept")).toBe("application/json");
    expect(Object.fromEntries(body)).toEqual({
      client_id: "gh-client",
      client_secret: "gh-secret-value",
      grant_type: "authorization_code",
      code: "code-123",
      redirect_uri: `${ORIGIN}/api/connect/github/callback`,
      code_verifier: verifier,
    });
    expect(lists.calls).toContainEqual(["github", { token: "ghu_tok" }]);
    const me = fetchCalls.find((c) => c.url === "https://api.github.com/user");
    expect(new Headers(me?.init?.headers).get("authorization")).toBe("Bearer ghu_tok");
    expect(store.saveConnection).toHaveBeenCalledWith("user_1", "github", {
      accessToken: "ghu_tok",
      refreshToken: "ghr_tok",
      expiresInSeconds: 28800,
      meta: { label: "ada-gh", workspaceId: "Acme", workspaceName: "Acme" },
    });
  });

  it("stores GitHub without an org when it is in none, since personal repositories still file", async () => {
    tokenReply = { access_token: "gho_tok", token_type: "bearer", scope: "repo,read:user" };
    const url = location(await runCallback("github"));
    expect(url.searchParams.get("connected")).toBe("github");
    expect(store.saveConnection).toHaveBeenCalledWith("user_1", "github", {
      accessToken: "gho_tok",
      refreshToken: undefined,
      expiresInSeconds: undefined,
      meta: { label: "ada-gh" },
    });
  });

  it("sends a GitHub user in several orgs to pick one", async () => {
    lists.github = [
      { login: "Acme", name: "Acme" },
      { login: "beta", name: "beta" },
    ];
    const url = location(await runCallback("github"));
    expect(url.toString()).toBe(`${ORIGIN}/connections?pick=github`);
    expect(savedMeta()).not.toHaveProperty("workspaceId");
  });

  it("keeps the org picked for a Clerk GitHub connection when the new token can see it", async () => {
    lists.github = [
      { login: "Acme", name: "Acme" },
      { login: "beta", name: "beta" },
    ];
    workspaces.legacyGithubPick.mockResolvedValue({ id: "acme", name: "acme" });
    clerk.accounts = [{ id: "ea_github", provider: "oauth_github" }];

    const url = location(await runCallback("github"));
    expect(url.searchParams.get("connected")).toBe("github");
    // Stored as GitHub spells it, and the Clerk GitHub account it replaces is gone.
    expect(savedMeta()).toMatchObject({ workspaceId: "Acme", workspaceName: "Acme" });
    expect(clerk.deleted).toEqual(["ea_github"]);
    // The pick lives on the connection now, so Clerk's copy goes.
    expect(workspaces.forgetLegacyGithubPick).toHaveBeenCalledWith("user_1");
  });

  it("keeps the Clerk-era GitHub pick in Clerk when the org listing comes back empty or fails", async () => {
    // listGithubOrgs reads a failure as an empty list.
    lists.github = [];
    workspaces.legacyGithubPick.mockResolvedValue({ id: "acme", name: "acme" });
    const url = location(await runCallback("github"));
    expect(url.searchParams.get("connected")).toBe("github");
    // No unproven pick is stored, and Clerk's stays for Settings to check again.
    expect(savedMeta()).not.toHaveProperty("workspaceId");
    expect(workspaces.forgetLegacyGithubPick).not.toHaveBeenCalled();
  });

  it("keeps a reconnected Jira on its site when the grant still covers it", async () => {
    lists.jira = [
      { id: "cloud-1", name: "acme", url: "https://acme.atlassian.net" },
      { id: "cloud-2", name: "beta", url: "https://beta.atlassian.net" },
    ];
    store.readConnectionMeta.mockResolvedValue({
      workspaceId: "cloud-2",
      workspaceName: "beta",
      siteUrl: "https://beta.atlassian.net",
    });
    const url = location(await runCallback("jira"));
    expect(url.searchParams.get("connected")).toBe("jira");
    expect(savedMeta()).toEqual({ workspaceId: "cloud-2", workspaceName: "beta", siteUrl: "https://beta.atlassian.net" });
  });

  it("asks a reconnected Jira for a site again when the grant no longer covers its old one", async () => {
    lists.jira = [
      { id: "cloud-1", name: "acme", url: "https://acme.atlassian.net" },
      { id: "cloud-3", name: "gamma", url: "https://gamma.atlassian.net" },
    ];
    store.readConnectionMeta.mockResolvedValue({ workspaceId: "cloud-2", workspaceName: "beta", siteUrl: "https://beta.atlassian.net" });
    const url = location(await runCallback("jira"));
    expect(url.toString()).toBe(`${ORIGIN}/connections?pick=jira`);
    expect(savedMeta()).toEqual({});
  });

  it("keeps a reconnected GitHub on its org, ahead of the Clerk-era pick", async () => {
    lists.github = [
      { login: "Acme", name: "Acme" },
      { login: "beta", name: "beta" },
    ];
    store.readConnectionMeta.mockResolvedValue({ label: "ada", workspaceId: "beta", workspaceName: "beta" });
    workspaces.legacyGithubPick.mockResolvedValue({ id: "acme", name: "acme" });
    const url = location(await runCallback("github"));
    expect(url.searchParams.get("connected")).toBe("github");
    expect(savedMeta()).toMatchObject({ workspaceId: "beta", workspaceName: "beta" });
    expect(workspaces.forgetLegacyGithubPick).not.toHaveBeenCalled();
  });

  it("asks for a pick when the org picked through Clerk isn't on the new GitHub account", async () => {
    lists.github = [
      { login: "Acme", name: "Acme" },
      { login: "beta", name: "beta" },
    ];
    workspaces.legacyGithubPick.mockResolvedValue({ id: "elsewhere", name: "elsewhere" });
    const url = location(await runCallback("github"));
    expect(url.toString()).toBe(`${ORIGIN}/connections?pick=github`);
    expect(savedMeta()).not.toHaveProperty("workspaceId");
  });

  it("reads GitHub's 200 that carries an error as a refused exchange", async () => {
    tokenReply = { error: "bad_verification_code", error_description: "The code passed is incorrect or expired." };
    const url = location(await runCallback("github"));
    expect(url.searchParams.get("error")).toBe("failed");
    expect(store.saveConnection).not.toHaveBeenCalled();
    // The status and the provider's code are logged; its description never is.
    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logged).toContain("200 bad_verification_code");
    expect(logged).not.toMatch(/incorrect/);
    expect(recorded(await runCallback("github"))).toEqual({
      provider: "github",
      code: "failed",
      reason: "bad_verification_code",
      detail: "The code passed is incorrect or expired.",
    });
  });

  it("exchanges a Notion code with Basic auth and a JSON body, and stores the workspace from the reply", async () => {
    tokenReply = {
      access_token: "nt_tok",
      token_type: "bearer",
      bot_id: "bot-1",
      workspace_id: "ws-uuid",
      workspace_name: "Acme HQ",
      workspace_icon: null,
      owner: { type: "user", user: { object: "user", id: "u1", name: "Ada Notion" } },
    };
    const res = await runCallback("notion", "/onboarding");
    expect(location(res).searchParams.get("connected")).toBe("notion");

    const { url, init } = tokenCall();
    expect(url.toString()).toBe("https://api.notion.com/v1/oauth/token");
    expect(init?.method).toBe("POST");
    const basic = Buffer.from("nt-client:nt-secret-value").toString("base64");
    expect(tokenHeaders().get("authorization")).toBe(`Basic ${basic}`);
    expect(tokenHeaders().get("content-type")).toBe("application/json");
    // The credentials ride only in the header.
    expect(JSON.parse(String(init?.body))).toEqual({
      grant_type: "authorization_code",
      code: "code-123",
      redirect_uri: `${ORIGIN}/api/connect/notion/callback`,
    });

    // No lister and no profile call: the reply already said it all.
    expect(fetchCalls).toHaveLength(1);
    expect(store.saveConnection).toHaveBeenCalledWith("user_1", "notion", {
      accessToken: "nt_tok",
      refreshToken: undefined,
      expiresInSeconds: undefined,
      meta: { label: "Ada Notion", workspaceId: "ws-uuid", workspaceName: "Acme HQ" },
    });
    expect(store.deleteOtherConnections).toHaveBeenCalledWith("user_1", "notion");
  });

  it("keeps a Notion refresh token when the reply carries one, and names a workspace-owned grant by its workspace", async () => {
    tokenReply = {
      access_token: "nt_tok",
      refresh_token: "nt_rt",
      expires_in: 3600,
      workspace_id: "ws-uuid",
      workspace_name: "Acme HQ",
      owner: { type: "workspace", workspace: true },
    };
    await runCallback("notion");
    expect(store.saveConnection).toHaveBeenCalledWith("user_1", "notion", {
      accessToken: "nt_tok",
      refreshToken: "nt_rt",
      expiresInSeconds: 3600,
      meta: { label: "Acme HQ", workspaceId: "ws-uuid", workspaceName: "Acme HQ" },
    });
  });

  it("stores nothing, and leaves the other trackers alone, when Notion names no workspace", async () => {
    tokenReply = { access_token: "nt_tok", workspace_name: "Acme HQ", owner: { user: { name: "Ada" } } };
    clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear" }];
    const res = await runCallback("notion");

    const url = location(res);
    expect(url.searchParams.get("error")).toBe("failed");
    expect(url.searchParams.get("provider")).toBe("notion");
    expect(clearsFlowCookie(res)).toBe(true);
    expect(store.saveConnection).not.toHaveBeenCalled();
    expect(store.deleteOtherConnections).not.toHaveBeenCalled();
    expect(clerk.deleted).toEqual([]);
  });

  it("logs no Notion secret when the exchange is refused", async () => {
    tokenReply = 401;
    const warn = vi.mocked(console.warn);
    const url = location(await runCallback("notion", "/connections", { code: "secret-code" }));
    expect(url.searchParams.get("error")).toBe("failed");
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain("secret-code");
    expect(logged).not.toContain("nt-secret-value");
    expect(logged).not.toContain(Buffer.from("nt-client:nt-secret-value").toString("base64"));
  });

  it("leaves the workspace unpicked and sends the user to pick one when there are several", async () => {
    lists.clickup = [
      { id: "1", name: "Acme" },
      { id: "2", name: "Side project" },
    ];
    const url = location(await runCallback("clickup", "/onboarding"));
    expect(url.toString()).toBe(`${ORIGIN}/connections?pick=clickup`);
    expect(savedMeta()).not.toHaveProperty("workspaceId");
    expect(savedMeta()).not.toHaveProperty("workspaceName");
  });

  it("does not store Azure DevOps without an organization", async () => {
    lists.azure = [];
    clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear" }];
    const res = await runCallback("azure");

    const url = location(res);
    expect(url.pathname).toBe("/connections");
    expect(url.searchParams.get("error")).toBe("no_org");
    expect(url.searchParams.get("provider")).toBe("azure");
    expect(clearsFlowCookie(res)).toBe(true);
    expect(store.saveConnection).not.toHaveBeenCalled();
    expect(store.deleteOtherConnections).not.toHaveBeenCalled();
    expect(clerk.deleted).toEqual([]);
    expect(db.orgDeletes).toEqual([]);
    // The empty list was confirmed with the new token.
    const accounts = fetchCalls.find((c) => c.url.includes("/_apis/accounts?memberId=member-1"));
    expect(new Headers(accounts?.init?.headers).get("authorization")).toBe("Bearer at_new");
  });

  it("reports a failed Azure DevOps listing as `failed`, not as no organization", async () => {
    lists.azure = [];
    azureAccounts = { status: 503, names: [] };
    clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear" }];
    const url = location(await runCallback("azure"));
    expect(url.searchParams.get("error")).toBe("failed");
    expect(url.searchParams.get("provider")).toBe("azure");
    expect(store.saveConnection).not.toHaveBeenCalled();
    expect(clerk.deleted).toEqual([]);
  });

  it("does not store Asana without a workspace", async () => {
    lists.asana = [];
    const url = location(await runCallback("asana"));
    expect(url.searchParams.get("error")).toBe("no_workspace");
    expect(url.searchParams.get("provider")).toBe("asana");
    expect(store.saveConnection).not.toHaveBeenCalled();
    expect(store.deleteOtherConnections).not.toHaveBeenCalled();
  });

  it("stores ClickUp without a workspace when it lists none", async () => {
    lists.clickup = [];
    const url = location(await runCallback("clickup"));
    expect(url.searchParams.get("connected")).toBe("clickup");
    expect(savedMeta()).not.toHaveProperty("workspaceId");
  });

  it("removes the user's Clerk tracker accounts and keeps the ones used to sign in", async () => {
    lists.clickup = [{ id: "1", name: "Acme" }];
    clerk.accounts = [
      { id: "ea_google", provider: "oauth_google" },
      { id: "ea_github", provider: "oauth_github" },
      { id: "ea_jira", provider: "oauth_atlassian" },
      { id: "ea_linear", provider: "oauth_linear" },
      { id: "ea_apple", provider: "oauth_apple" },
    ];
    await runCallback("clickup");
    expect(clerk.deleted.sort()).toEqual(["ea_github", "ea_jira", "ea_linear"]);
  });

  it("never reads an empty or missing provider match as matching every account", async () => {
    lists.clickup = [{ id: "1", name: "Acme" }];
    registry.clerk.push({ clerkMatch: "" }, {});
    clerk.accounts = [
      { id: "ea_google", provider: "oauth_google" },
      { id: "ea_linear", provider: "oauth_linear" },
    ];
    await runCallback("clickup");
    expect(clerk.deleted).toEqual(["ea_linear"]);
  });

  it("keeps a Clerk tracker account that is the user's only way to sign in, and still switches", async () => {
    lists.clickup = [{ id: "1", name: "Acme" }];
    clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear" }];
    // No password, no other account, and the only email came from Linear.
    clerk.emails = [{ verification: { status: "verified", strategy: "from_oauth_linear" } }];
    const url = location(await runCallback("clickup"));
    expect(url.searchParams.get("connected")).toBe("clickup");
    expect(clerk.deleted).toEqual([]);
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(expect.stringContaining("only way to sign in"));
  });

  it.each([
    ["a password", () => (clerk.passwordEnabled = true)],
    ["another external account", () => clerk.accounts.push({ id: "ea_google", provider: "oauth_google" })],
    ["an email verified another way", () => (clerk.emails = [{ verification: { status: "verified", strategy: "email_link" } }])],
  ])("removes a Clerk tracker account when the user can still sign in with %s", async (_label, other) => {
    lists.clickup = [{ id: "1", name: "Acme" }];
    clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear" }];
    clerk.emails = [{ verification: { status: "verified", strategy: "from_oauth_linear" } }];
    other();
    await runCallback("clickup");
    expect(clerk.deleted).toEqual(["ea_linear"]);
  });

  it("switches trackers: removes the others, keeps the new one, and forgets the cached org and lists", async () => {
    lists.clickup = [{ id: "1", name: "Acme" }];
    clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear" }];
    const url = location(await runCallback("clickup"));
    expect(url.searchParams.get("connected")).toBe("clickup");
    expect(clerk.deleted).toEqual(["ea_linear"]);
    expect(store.deleteOtherConnections).toHaveBeenCalledWith("user_1", "clickup");
    expect(store.deleteConnection).not.toHaveBeenCalled();
    expect(db.orgDeletes).toEqual(["user_1"]);
    expect(workspaces.forgetWorkspaces).toHaveBeenCalledWith("user_1");
  });

  describe("the account's photo", () => {
    const GH_PHOTO = "https://avatars.githubusercontent.com/u/7?v=4";
    const proxied = (src: string) =>
      `https://img.clerk.com/${Buffer.from(JSON.stringify({ type: "proxy", src })).toString("base64url")}`;
    const GOOGLE = proxied("https://lh3.googleusercontent.com/a/ada");
    const LINEAR = proxied("https://public.linear.app/ada.png");

    it("gives a user with no photo of their own the new account's", async () => {
      githubPhoto = { url: GH_PHOTO };
      const url = location(await runCallback("github"));
      expect(url.searchParams.get("connected")).toBe("github");
      expect(clerk.log).toEqual(["photo image/png"]);
    });

    it("sets it before removing the Clerk tracker account whose photo the user shows", async () => {
      clerk.hasImage = true;
      clerk.imageUrl = LINEAR;
      clerk.accounts = [
        { id: "ea_google", provider: "oauth_google", imageUrl: GOOGLE },
        { id: "ea_linear", provider: "oauth_linear", imageUrl: LINEAR },
      ];
      githubPhoto = { url: GH_PHOTO };
      const url = location(await runCallback("github"));
      expect(url.searchParams.get("connected")).toBe("github");
      expect(clerk.log).toEqual(["photo image/png", "delete ea_linear"]);
    });

    it("never replaces a photo from a sign-in method such as Google", async () => {
      clerk.hasImage = true;
      clerk.imageUrl = GOOGLE;
      clerk.accounts = [
        { id: "ea_google", provider: "oauth_google", imageUrl: GOOGLE },
        { id: "ea_linear", provider: "oauth_linear", imageUrl: LINEAR },
      ];
      githubPhoto = { url: GH_PHOTO };
      await runCallback("github");
      expect(clerk.log).toEqual(["delete ea_linear"]);
      expect(fetchCalls.some((c) => c.url === GH_PHOTO)).toBe(false);
    });

    it("keeps the removed Clerk account's photo when the new account has none", async () => {
      lists.clickup = [{ id: "1", name: "Acme" }];
      clerk.hasImage = true;
      clerk.imageUrl = LINEAR;
      clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear", imageUrl: LINEAR }];
      clerkPhotos.add(LINEAR);
      const url = location(await runCallback("clickup"));
      expect(url.searchParams.get("connected")).toBe("clickup");
      expect(clerk.log).toEqual(["photo image/png", "delete ea_linear"]);
    });

    it.each([
      ["the photo can't be fetched", () => (githubPhoto = { url: GH_PHOTO, down: true })],
      [
        "Clerk refuses it",
        () => {
          githubPhoto = { url: GH_PHOTO };
          clerk.failUpload = true;
        },
      ],
    ])("still connects, and switches, when %s", async (_label, breakIt) => {
      clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear", imageUrl: LINEAR }];
      breakIt();
      const res = await runCallback("github");
      expect(location(res).searchParams.get("connected")).toBe("github");
      expect(recorded(res)).toBeNull();
      expect(clerk.log).toEqual(["delete ea_linear"]);
      expect(store.deleteOtherConnections).toHaveBeenCalledWith("user_1", "github");
      expect(store.deleteConnection).not.toHaveBeenCalled();
    });
  });

  // Registry order puts Linear first, so a Linear account that survived the
  // cleanup would keep winning while the card said ClickUp was connected.
  it.each([
    ["a Clerk account cannot be removed", () => (clerk.failDelete = true)],
    ["the Clerk user cannot be read", () => (clerk.failGetUser = true)],
  ])("rolls the new connection back, leaving the owned rows alone, when %s", async (_label, breakIt) => {
    lists.clickup = [{ id: "1", name: "Acme" }];
    clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear" }];
    breakIt();
    const res = await runCallback("clickup", "/onboarding");
    const url = location(res);
    expect(url.pathname).toBe("/onboarding");
    expect(url.searchParams.get("error")).toBe("failed");
    expect(url.searchParams.get("provider")).toBe("clickup");
    expect(url.searchParams.has("connected")).toBe(false);
    expect(clearsFlowCookie(res)).toBe(true);
    expect(store.saveConnection).toHaveBeenCalled();
    expect(store.deleteConnection).toHaveBeenCalledWith("user_1", "clickup");
    // Clerk is cleaned up first, so its failure touches no owned row.
    expect(store.deleteOtherConnections).not.toHaveBeenCalled();
  });

  it("rolls the new connection back when the other owned connections cannot be removed", async () => {
    lists.monday = [{ id: "1", name: "Acme" }];
    store.deleteOtherConnections.mockRejectedValue(new Error("db down"));
    const url = location(await runCallback("monday"));
    expect(url.searchParams.get("error")).toBe("failed");
    expect(url.searchParams.get("provider")).toBe("monday");
    expect(store.deleteOtherConnections).toHaveBeenCalledTimes(2);
    expect(store.deleteConnection).toHaveBeenCalledWith("user_1", "monday");
  });

  it("retries removing the other owned connections once, and connects", async () => {
    lists.monday = [{ id: "1", name: "Acme" }];
    store.deleteOtherConnections.mockRejectedValueOnce(new Error("db blip"));
    const url = location(await runCallback("monday"));
    expect(url.searchParams.get("connected")).toBe("monday");
    expect(store.deleteOtherConnections).toHaveBeenCalledTimes(2);
    expect(store.deleteConnection).not.toHaveBeenCalled();
  });

  // Removing a Clerk account can't be undone: rolling back after it would
  // leave the user with no tracker at all.
  it("keeps the new connection when the owned cleanup fails after the Clerk accounts went", async () => {
    lists.monday = [{ id: "1", name: "Acme" }];
    clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear" }];
    store.deleteOtherConnections.mockRejectedValue(new Error("db down"));
    const url = location(await runCallback("monday"));
    expect(url.searchParams.get("error")).toBe("failed");
    expect(clerk.deleted).toEqual(["ea_linear"]);
    expect(store.deleteConnection).not.toHaveBeenCalled();
  });

  it("still rolls back when a Clerk account kept as a sign-in is left to fall back on", async () => {
    lists.monday = [{ id: "1", name: "Acme" }];
    clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear" }];
    clerk.emails = [{ verification: { status: "verified", strategy: "from_oauth_linear" } }];
    store.deleteOtherConnections.mockRejectedValue(new Error("db down"));
    const url = location(await runCallback("monday"));
    expect(url.searchParams.get("error")).toBe("failed");
    expect(clerk.deleted).toEqual([]);
    expect(store.deleteConnection).toHaveBeenCalledWith("user_1", "monday");
  });

  it("keeps a reconnected tracker's row when the cleanup fails, since it replaced the old one in place", async () => {
    lists.gitlab = [{ id: "1", name: "Acme" }];
    store.readConnectionMeta.mockResolvedValue({ label: "Ada GitLab" });
    clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear" }];
    clerk.failDelete = true;
    const url = location(await runCallback("gitlab"));
    expect(url.searchParams.get("error")).toBe("failed");
    expect(store.readConnectionMeta).toHaveBeenCalledWith("user_1", "gitlab");
    expect(store.saveConnection).toHaveBeenCalled();
    expect(store.deleteConnection).not.toHaveBeenCalled();
  });

  it("still reports `failed` when the rollback itself fails, logging nothing secret", async () => {
    lists.clickup = [{ id: "1", name: "Acme" }];
    clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear" }];
    clerk.failDelete = true;
    store.deleteConnection.mockRejectedValue(new Error("db down"));
    const url = location(await runCallback("clickup", "/connections", { code: "secret-code" }));
    expect(url.searchParams.get("error")).toBe("failed");
    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logged).not.toContain("secret-code");
    expect(logged).not.toContain("at_new");
    expect(logged).not.toContain("cu-secret-value");
  });

  it("rolls back a Trello switch whose cleanup fails, and tells the relay page so", async () => {
    clerk.accounts = [{ id: "ea_jira", provider: "oauth_atlassian" }];
    clerk.failDelete = true;
    const { state, cookie } = await startFlow("trello");
    const res = await relayPost(relayReq({ token: "trello_tok", state }, { cookie }), ctx("trello"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { redirect: string }).redirect).toBe("/connections?error=failed&provider=trello");
    expect(store.deleteConnection).toHaveBeenCalledWith("user_1", "trello");
  });

  it("reports a refused exchange as `failed` without storing anything or logging secrets", async () => {
    tokenReply = 400;
    const warn = vi.mocked(console.warn);
    const res = await runCallback("azure", "/connections", { code: "secret-code" });
    const url = location(res);
    expect(url.searchParams.get("error")).toBe("failed");
    expect(url.searchParams.get("provider")).toBe("azure");
    expect(clearsFlowCookie(res)).toBe(true);
    expect(store.saveConnection).not.toHaveBeenCalled();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain("secret-code");
    expect(logged).not.toContain("az-secret-value");
  });

  it.each([
    ["access_denied", "cancelled"],
    ["server_error", "failed"],
  ])("maps the provider's %s to `%s`, never passing its text on", async (error, code) => {
    const url = location(
      await runCallback("asana", "/connections", { error, error_description: "Visit evil.example to fix this" }),
    );
    expect(url.searchParams.get("error")).toBe(code);
    expect(url.toString()).not.toContain("evil");
    expect(fetchCalls).toHaveLength(0);
  });

  it("reports `unavailable` when the provider was unconfigured mid-flow", async () => {
    const { state, cookie } = await startFlow("monday");
    vi.stubEnv("MONDAY_CLIENT_SECRET", "");
    const res = await callback(callbackReq("monday", { code: "c1", state }, cookie), ctx("monday"));
    const url = location(res);
    expect(url.searchParams.get("error")).toBe("unavailable");
    expect(url.searchParams.get("provider")).toBe("monday");
    expect(fetchCalls).toHaveLength(0);
  });

  it("reports a failed save as `failed` and leaves the other trackers alone", async () => {
    lists.monday = [{ id: "1", name: "Acme" }];
    clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear" }];
    store.saveConnection.mockRejectedValueOnce(new Error("db down"));
    const url = location(await runCallback("monday"));
    expect(url.searchParams.get("error")).toBe("failed");
    expect(store.deleteOtherConnections).not.toHaveBeenCalled();
    expect(clerk.deleted).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// callback: why it failed
// ---------------------------------------------------------------------------

describe("callback: the error cookie", () => {
  it("records the provider's error and description, never putting them in the URL", async () => {
    const res = await runCallback("azure", "/onboarding", { error: "invalid_client", error_description: AADSTS650052 });
    expect(location(res).toString()).toBe(`${ORIGIN}/onboarding?error=failed&provider=azure`);
    expect(clearsFlowCookie(res)).toBe(true);
    expect(fetchCalls).toHaveLength(0);

    const f = recorded(res);
    expect(f).toMatchObject({ provider: "azure", code: "failed", reason: "AADSTS650052" });
    expect(f?.detail).toMatch(/^AADSTS650052: The app is trying to access a service/);
    expect(f?.detail).not.toMatch(/Trace ID|Correlation ID/);

    const set = errorCookieSet(res)!;
    for (const attr of ["HttpOnly", "SameSite=Lax", "Path=/;", "Max-Age=600"]) expect(set).toContain(attr);
    expect(set).not.toContain("Secure");
  });

  it.each([
    ["access_denied", "cancelled"],
    ["server_error", "failed"],
  ])("records %s as `%s`, its text in the cookie and not the URL", async (error, code) => {
    const res = await runCallback("asana", "/connections", { error, error_description: "Visit evil.example to fix this" });
    expect(location(res).toString()).not.toContain("evil");
    expect(recorded(res)).toEqual({ provider: "asana", code, reason: error, detail: "Visit evil.example to fix this" });
  });

  it("sets a Secure cookie when the app is served over https", async () => {
    vi.stubEnv("APP_URL", "https://cloud.example.com");
    const res = await runCallback("gitlab", "/connections", { error: "invalid_scope" });
    expect(errorCookieSet(res)).toContain("Secure");
  });

  it("records a refused exchange from the named fields of the JSON reply, logging the status and code only", async () => {
    tokenReply = 401;
    tokenErrorBody = {
      error: "invalid_client",
      error_description:
        "AADSTS7000215: Invalid client secret provided. Ensure the secret being sent in the request is the client secret value.\r\nTrace ID: 1",
      error_codes: [7000215],
    };
    const res = await runCallback("azure", "/connections", { code: "secret-code" });
    expect(location(res).toString()).toBe(`${ORIGIN}/connections?error=failed&provider=azure`);
    expect(recorded(res)).toEqual({
      provider: "azure",
      code: "failed",
      reason: "AADSTS7000215",
      detail:
        "AADSTS7000215: Invalid client secret provided. Ensure the secret being sent in the request is the client secret value.",
    });
    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logged).toContain("azure refused the code exchange: 401 AADSTS7000215");
    expect(logged).not.toContain("Invalid client secret");
  });

  it.each([
    ["clickup", 400, { err: "Client not found", ECODE: "OAUTH_010" }, { reason: "OAUTH_010", detail: "Client not found" }],
    [
      "asana",
      400,
      { errors: [{ message: "The redirect_uri parameter does not match a valid url for the application." }] },
      { reason: "HTTP 400", detail: "The redirect_uri parameter does not match a valid url for the application." },
    ],
    ["notion", 401, "<html>Unauthorized</html>", { reason: "HTTP 401" }],
    ["monday", 503, { error: "temporarily_unavailable" }, { reason: "temporarily_unavailable" }],
  ] as const)("records %s's refusal (%i)", async (provider, status, body, want) => {
    tokenReply = status;
    tokenErrorBody = body;
    expect(recorded(await runCallback(provider))).toEqual({ provider, code: "failed", ...want });
  });

  it("never records the code, the client secret or a token, even when the provider echoes them", async () => {
    tokenReply = 400;
    tokenErrorBody = {
      error: "invalid_grant",
      error_description: "Code secret-code-123 is not valid for client gl-secret-value",
      access_token: "at_leaked_token",
      refresh_token: "rt_leaked_token",
    };
    const res = await runCallback("gitlab", "/connections", { code: "secret-code-123" });
    expect(recorded(res)?.detail).toBe("Code [redacted] is not valid for client [redacted]");
    const raw = errorCookieSet(res)!.split(";")[0].slice(ERROR_COOKIE.length + 1).split(".")[0];
    const stored = Buffer.from(raw, "base64url").toString("utf8");
    for (const secret of ["secret-code-123", "gl-secret-value", "at_leaked", "rt_leaked"]) {
      expect(stored).not.toContain(secret);
    }
  });

  it("records an unreachable token endpoint as Brief's own reason", async () => {
    const { state, cookie } = await startFlow("linear");
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("fetch failed"));
    const res = await callback(callbackReq("linear", { code: "c1", state }, cookie), ctx("linear"));
    expect(recorded(res)).toEqual({ provider: "linear", code: "failed", reason: BRIEF_REASON.unreachable });
  });

  it("records the status of a failed Azure DevOps organization check", async () => {
    lists.azure = [];
    azureAccounts = { status: 401, names: [] };
    const res = await runCallback("azure");
    expect(location(res).searchParams.get("error")).toBe("failed");
    expect(recorded(res)).toEqual({ provider: "azure", code: "failed", reason: "vssps 401" });
  });

  it("records an account with no Azure DevOps organization as `no_org` alone", async () => {
    lists.azure = [];
    expect(recorded(await runCallback("azure"))).toEqual({ provider: "azure", code: "no_org" });
  });

  it.each([
    ["another user's", () => flowFor("azure", { userId: "user_2" })],
    ["another browser's", () => flowFor("azure", { nonce: "someone-elses-nonce" })],
  ])("records %s state as Brief's own reason, with nothing from the query string", async (_label, make) => {
    const { state, cookie } = make();
    const res = await callback(
      callbackReq("azure", { error: "x", error_description: "Visit evil.example", state }, cookie),
      ctx("azure"),
    );
    expect(location(res).toString()).toBe(`${ORIGIN}/connections?error=failed&provider=azure`);
    expect(recorded(res)).toEqual({ provider: "azure", code: "failed", reason: BRIEF_REASON.state });
    expect(clearsFlowCookie(res)).toBe(false);
  });

  it("records `unavailable` when the provider was unconfigured mid-flow", async () => {
    const { state, cookie } = await startFlow("monday");
    vi.stubEnv("MONDAY_CLIENT_SECRET", "");
    const res = await callback(callbackReq("monday", { code: "c1", state }, cookie), ctx("monday"));
    expect(recorded(res)).toEqual({ provider: "monday", code: "unavailable" });
  });

  it("records a site listing that failed, a switch that failed and a save that failed", async () => {
    lists.jira = null;
    expect(recorded(await runCallback("jira"))).toEqual({ provider: "jira", code: "failed", reason: BRIEF_REASON.list });

    lists.monday = [{ id: "1", name: "Acme" }];
    store.saveConnection.mockRejectedValueOnce(new Error("db down"));
    expect(recorded(await runCallback("monday"))).toEqual({ provider: "monday", code: "failed", reason: BRIEF_REASON.save });

    store.deleteOtherConnections.mockRejectedValue(new Error("db down"));
    expect(recorded(await runCallback("monday"))).toEqual({
      provider: "monday",
      code: "failed",
      reason: BRIEF_REASON.switch,
    });
  });

  it("records nothing when the connect succeeds", async () => {
    lists.gitlab = [{ id: "1", name: "Acme" }];
    const res = await runCallback("gitlab");
    expect(location(res).searchParams.get("connected")).toBe("gitlab");
    expect(errorCookieSet(res)).toBeNull();
  });

  it("records the Trello relay's failures too", async () => {
    // A state this browser didn't start.
    const forged = flowFor("trello", { userId: "user_2" });
    const refused = await relayPost(relayReq({ token: "t", state: forged.state }, { cookie: forged.cookie }), ctx("trello"));
    expect(recorded(refused)).toEqual({ provider: "trello", code: "failed", reason: BRIEF_REASON.state });

    // Declined at Trello.
    const declined = await startFlow("trello");
    const cancelled = await relayPost(relayReq({ token: "", state: declined.state }, { cookie: declined.cookie }), ctx("trello"));
    expect(recorded(cancelled)).toEqual({ provider: "trello", code: "cancelled" });
    expect(clearsFlowCookie(cancelled)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Trello relay
// ---------------------------------------------------------------------------

/**
 * Run the relay page's script against a fake browser, recording the order of
 * what it does.
 */
type RelayPost = {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string; credentials: string };
};

async function runRelay(
  script: string,
  { hash, search, reply }: { hash: string; search: string; reply: () => Promise<{ json: () => Promise<unknown> }> },
) {
  const events: string[] = [];
  // A holder, not a let: TypeScript cannot see the assignment inside the
  // fake fetch and would narrow a plain variable to null.
  const seen: { posted: RelayPost | null } = { posted: null };
  const location = {
    hash,
    search,
    pathname: "/api/connect/trello/callback",
    replace: (u: string) => events.push(`navigate ${u}`),
  };
  const history = {
    replaceState: (_s: unknown, _t: string, u: string) => {
      events.push(`replaceState ${u}`);
      location.hash = "";
      location.search = "";
    },
  };
  const fetch = (url: string, init: RelayPost["init"]) => {
    events.push(`fetch ${url}`);
    seen.posted = { url, init };
    return reply();
  };
  runInNewContext(script, { location, history, fetch, URLSearchParams, encodeURIComponent });
  await new Promise((r) => setTimeout(r, 0));
  return { events, posted: seen.posted };
}

async function relayScript(): Promise<string> {
  const { state, cookie } = await startFlow("trello");
  const html = await (await callback(callbackReq("trello", { state }, cookie), ctx("trello"))).text();
  return html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
}

describe("Trello relay", () => {
  it("serves a relay page whose script and style are allowed by its own CSP, and keeps the flow cookie", async () => {
    const { state, cookie } = await startFlow("trello", "/onboarding");
    const page = await callback(callbackReq("trello", { state }, cookie), ctx("trello"));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    // Under no-referrer the relay's POST would carry `Origin: null`.
    expect(page.headers.get("referrer-policy")).toBe("same-origin");
    expect(clearsFlowCookie(page)).toBe(false);

    const html = await page.text();
    const csp = page.headers.get("content-security-policy") ?? "";
    const hash = (s: string) => createHash("sha256").update(s, "utf8").digest("base64");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    expect(script).toContain("location.hash");
    expect(csp).toContain(`'sha256-${hash(script)}'`);
    expect(csp).toContain(`'sha256-${hash(style)}'`);
    expect(csp).not.toContain("unsafe-inline");
  });

  it("refuses to serve the relay page to another browser", async () => {
    const { state } = flowFor("trello");
    const { cookie } = flowFor("trello");
    const res = await callback(callbackReq("trello", { state }, cookie), ctx("trello"));
    expect(location(res).toString()).toBe(`${ORIGIN}/connections?error=failed&provider=trello`);
  });

  it("relay script: reads the fragment, wipes the URL, posts, then follows the server's path", async () => {
    const script = await relayScript();
    const { events, posted } = await runRelay(script, {
      hash: "#token=trello_tok",
      search: "?state=the-state",
      reply: async () => ({ json: async () => ({ ok: true, redirect: "/onboarding?connected=trello" }) }),
    });
    expect(events).toEqual([
      "replaceState /api/connect/trello/callback",
      "fetch /api/connect/trello/callback",
      "navigate /onboarding?connected=trello",
    ]);
    expect(posted?.init.method).toBe("POST");
    expect(posted?.init.credentials).toBe("same-origin");
    expect(posted?.init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(posted!.init.body)).toEqual({ token: "trello_tok", state: "the-state" });
  });

  it.each(["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)"])(
    "relay script: never follows %s",
    async (redirect) => {
      const script = await relayScript();
      const { events } = await runRelay(script, {
        hash: "#token=t",
        search: "?state=s",
        reply: async () => ({ json: async () => ({ redirect }) }),
      });
      expect(events.at(-1)).toBe("navigate /connections?error=failed&provider=trello");
    },
  );

  it("relay script: falls back to a failure page when the POST fails", async () => {
    const script = await relayScript();
    const { events } = await runRelay(script, {
      hash: "#token=t",
      search: "?state=s",
      reply: () => Promise.reject(new Error("offline")),
    });
    expect(events.at(-1)).toBe("navigate /connections?error=failed&provider=trello");
  });

  it("saves the posted token, with its member id and single workspace, and clears the flow cookie", async () => {
    const { state, cookie } = await startFlow("trello", "/onboarding");
    lists.trello = [{ id: "org1", name: "Acme" }];
    const res = await relayPost(relayReq({ token: "trello_tok", state }, { cookie }), ctx("trello"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, redirect: "/onboarding?connected=trello" });
    expect(clearsFlowCookie(res)).toBe(true);
    expect(lists.calls).toContainEqual(["trello", { key: "trello-key", token: "trello_tok" }]);
    expect(store.saveConnection).toHaveBeenCalledWith("user_1", "trello", {
      accessToken: "trello_tok",
      refreshToken: undefined,
      expiresInSeconds: undefined,
      meta: { memberId: "member_1", label: "Ada L", workspaceId: "org1", workspaceName: "Acme" },
    });
    expect(store.deleteOtherConnections).toHaveBeenCalledWith("user_1", "trello");
  });

  it.each([
    ["another user's", () => flowFor("trello", { userId: "user_2" })],
    ["a ClickUp", () => flowFor("trello", { stateProvider: "clickup" })],
    ["another browser's", () => flowFor("trello", { nonce: "someone-elses-nonce" })],
  ])("refuses %s state with a 400", async (_label, make) => {
    const { state, cookie } = make();
    const res = await relayPost(relayReq({ token: "trello_tok", state }, { cookie }), ctx("trello"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { redirect: string }).redirect).toBe("/connections?error=failed&provider=trello");
    expect(store.saveConnection).not.toHaveBeenCalled();
  });

  it("refuses a post without the flow cookie", async () => {
    const { state } = await startFlow("trello");
    const res = await relayPost(relayReq({ token: "trello_tok", state }), ctx("trello"));
    expect(res.status).toBe(400);
    expect(store.saveConnection).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-JSON body", { contentType: "text/plain" }, 415],
    ["another origin", { origin: "https://evil.example" }, 403],
    ["no origin from another site", { origin: null, site: "cross-site" }, 403],
  ] as const)("refuses %s", async (_label, opts, status) => {
    const { state, cookie } = await startFlow("trello");
    const res = await relayPost(relayReq({ token: "trello_tok", state }, { cookie, ...opts }), ctx("trello"));
    expect(res.status).toBe(status);
    expect(store.saveConnection).not.toHaveBeenCalled();
  });

  it("sends the user back with `cancelled` when Trello returned no token", async () => {
    const { state, cookie } = await startFlow("trello");
    const res = await relayPost(relayReq({ token: "", state }, { cookie }), ctx("trello"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { redirect: string }).redirect).toBe("/connections?error=cancelled&provider=trello");
    expect(store.saveConnection).not.toHaveBeenCalled();
  });

  it("stores nothing, and leaves the other trackers alone, when the token cannot read its member", async () => {
    trelloMeOk = false;
    clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear" }];
    const { state, cookie } = await startFlow("trello");
    const res = await relayPost(relayReq({ token: "forged", state }, { cookie }), ctx("trello"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { redirect: string }).redirect).toBe("/connections?error=failed&provider=trello");
    expect(store.saveConnection).not.toHaveBeenCalled();
    expect(store.deleteOtherConnections).not.toHaveBeenCalled();
    expect(clerk.deleted).toEqual([]);
  });

  it("only takes a posted token for Trello", async () => {
    const { state, cookie } = flowFor("clickup");
    const res = await relayPost(relayReq({ token: "x", state }, { cookie, provider: "clickup" }), ctx("clickup"));
    expect(res.status).toBe(404);
    expect(store.saveConnection).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// disconnect
// ---------------------------------------------------------------------------

describe("disconnect", () => {
  const post = (provider: string, headers: Record<string, string> = { origin: ORIGIN }) =>
    disconnect(
      new NextRequest(`${ORIGIN}/api/connect/${provider}/disconnect`, { method: "POST", headers }),
      ctx(provider),
    );

  it("deletes the connection, the cached org and the remembered workspace lists", async () => {
    const res = await post("clickup");
    expect(await res.json()).toEqual({ ok: true });
    expect(store.deleteConnection).toHaveBeenCalledWith("user_1", "clickup");
    expect(db.orgDeletes).toEqual(["user_1"]);
    expect(workspaces.forgetWorkspaces).toHaveBeenCalledWith("user_1");
  });

  it.each([
    ["another origin", { origin: "https://evil.example" }],
    ["no origin from another site", { "sec-fetch-site": "cross-site" }],
  ])("refuses %s", async (_label, headers) => {
    const res = await post("clickup", headers);
    expect(res.status).toBe(403);
    expect(store.deleteConnection).not.toHaveBeenCalled();
  });

  it("reports a failed delete with a 500 and keeps the cached org", async () => {
    store.deleteConnection.mockRejectedValueOnce(new Error("db down"));
    const res = await post("clickup");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "failed" });
    expect(db.orgDeletes).toEqual([]);
  });

  it("refuses an unknown provider", async () => {
    expect((await post("bitbucket")).status).toBe(404);
    expect(store.deleteConnection).not.toHaveBeenCalled();
  });

  it("asks Clerk nothing for a tracker that never had a Clerk account", async () => {
    clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear" }];
    expect(await (await post("clickup")).json()).toEqual({ ok: true });
    expect(clerk.reads).toBe(0);
    expect(clerk.deleted).toEqual([]);
  });

  it.each([
    ["linear", "ea_linear"],
    ["jira", "ea_jira"],
    ["github", "ea_github"],
  ])("removes %s's Brief row and its Clerk account from before the move, and nothing else", async (provider, id) => {
    clerk.accounts = [
      { id: "ea_google", provider: "oauth_google" },
      { id: "ea_linear", provider: "oauth_linear" },
      { id: "ea_jira", provider: "oauth_atlassian" },
      { id: "ea_github", provider: "oauth_github" },
    ];
    const res = await post(provider);
    expect(await res.json()).toEqual({ ok: true });
    expect(store.deleteConnection).toHaveBeenCalledWith("user_1", provider);
    expect(clerk.deleted).toEqual([id]);
    expect(db.orgDeletes).toEqual(["user_1"]);
  });

  it("keeps the photo the user shows from the Clerk account it removes", async () => {
    const linear = `https://img.clerk.com/${Buffer.from(JSON.stringify({ type: "proxy", src: "https://public.linear.app/ada.png" })).toString("base64url")}`;
    clerk.hasImage = true;
    clerk.imageUrl = linear;
    clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear", imageUrl: linear }];
    clerkPhotos.add(linear);
    expect(await (await post("linear")).json()).toEqual({ ok: true });
    expect(clerk.log).toEqual(["photo image/png", "delete ea_linear"]);
  });

  it("drops only the Brief row when asked to keep the Clerk account", async () => {
    clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear" }];
    const res = await disconnect(
      new NextRequest(`${ORIGIN}/api/connect/linear/disconnect?clerk=keep`, { method: "POST", headers: { origin: ORIGIN } }),
      ctx("linear"),
    );
    expect(await res.json()).toEqual({ ok: true });
    expect(store.deleteConnection).toHaveBeenCalledWith("user_1", "linear");
    expect(clerk.reads).toBe(0);
    expect(clerk.deleted).toEqual([]);
  });

  it("stands by a removed Brief row when Clerk can't be read to look for a leftover account", async () => {
    clerk.failGetUser = true;
    const res = await post("github");
    expect(await res.json()).toEqual({ ok: true });
    expect(store.deleteConnection).toHaveBeenCalledWith("user_1", "github");
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      expect.stringContaining("could not read the Clerk user"),
      "Error",
    );
  });

  it("leaves a Clerk account that is the user's only way to sign in, and says the disconnect failed", async () => {
    clerk.accounts = [{ id: "ea_github", provider: "oauth_github" }];
    clerk.emails = [{ verification: { status: "verified", strategy: "from_oauth_github" } }];
    const res = await post("github");
    expect(res.status).toBe(409);
    expect(clerk.deleted).toEqual([]);
  });

  it("reports a Clerk account it couldn't remove, after removing the Brief row", async () => {
    clerk.accounts = [{ id: "ea_linear", provider: "oauth_linear" }];
    clerk.failDelete = true;
    const res = await post("linear");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "failed" });
    expect(store.deleteConnection).toHaveBeenCalledWith("user_1", "linear");
    // The row went, so the org and lists built on it go too.
    expect(db.orgDeletes).toEqual(["user_1"]);
    expect(workspaces.forgetWorkspaces).toHaveBeenCalledWith("user_1");
  });

  it("requires a signed-in user", async () => {
    session.userId = null;
    expect((await post("clickup")).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// /api/me/connections
// ---------------------------------------------------------------------------

describe("/api/me/connections", () => {
  it("lists the owned connections with their account and workspace, and never a token", async () => {
    vi.stubEnv("MONDAY_CLIENT_ID", "");
    db.rows = [
      {
        user_id: "user_1",
        provider: "trello",
        access_token_enc: "ENC_ACCESS",
        refresh_token_enc: "ENC_REFRESH",
        account_meta: { label: "Ada L", memberId: "m1" },
      },
      {
        user_id: "user_1",
        provider: "clickup",
        access_token_enc: "ENC_ACCESS_2",
        refresh_token_enc: null,
        account_meta: { label: "ada", workspaceId: "9001", workspaceName: "Acme" },
      },
      { user_id: "user_2", provider: "asana", access_token_enc: "OTHER", account_meta: {} },
    ];
    const res = await myConnections(meReq());
    const text = await res.text();
    expect(text).not.toMatch(/ENC_|OTHER|token/i);
    expect(db.selects.join(" ")).not.toMatch(/token|\*/);
    expect(JSON.parse(text)).toEqual({
      owned: [
        { provider: "clickup", label: "ada", workspace: { id: "9001", name: "Acme" } },
        { provider: "trello", label: "Ada L", workspace: null },
      ],
      configured: {
        linear: true,
        jira: true,
        github: true,
        gitlab: true,
        azure: true,
        clickup: true,
        notion: true,
        trello: true,
        asana: true,
        monday: false,
      },
      lastError: null,
    });
  });

  it("lists Linear, Jira and GitHub with the rest, and says when their OAuth apps aren't set up here", async () => {
    vi.stubEnv("JIRA_CLIENT_ID", "");
    db.rows = [
      {
        user_id: "user_1",
        provider: "jira",
        access_token_enc: "ENC_ACCESS",
        account_meta: { workspaceId: "cloud-1", workspaceName: "acme", siteUrl: "https://acme.atlassian.net" },
      },
    ];
    const body = await (await myConnections(meReq())).json();
    expect(body.owned).toEqual([{ provider: "jira", label: null, workspace: { id: "cloud-1", name: "acme" } }]);
    expect(body.configured).toMatchObject({ linear: true, jira: false, github: true });
  });

  it("requires a signed-in user", async () => {
    session.userId = null;
    expect((await myConnections(meReq())).status).toBe(401);
  });

  /** The `name=value` pair of the error cookie a callback set, as the browser sends it back. */
  async function failedConnect(provider: OwnedProvider, params: Record<string, string>) {
    const set = errorCookieSet(await runCallback(provider, "/connections", params));
    if (!set) throw new Error("the callback set no error cookie");
    return set.split(";")[0];
  }

  const clearsErrorCookie = (res: Response) =>
    res.headers.getSetCookie().some((s) => s.startsWith(`${ERROR_COOKIE}=;`) && s.includes("Max-Age=0") && s.includes("Path=/;"));

  it("explains the last failed connect once, and clears the cookie in the same response", async () => {
    const cookie = await failedConnect("azure", { error: "invalid_client", error_description: AADSTS650052 });
    const res = await myConnections(meReq(cookie));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(clearsErrorCookie(res)).toBe(true);
    const { lastError } = (await res.json()) as { lastError: { provider: string; message: string; detail?: string } };
    expect(lastError).toEqual({
      provider: "azure",
      message:
        "Azure DevOps isn't set up on this Microsoft organization yet. Create an organization at dev.azure.com, then connect again.",
      detail: expect.stringMatching(/^Azure DevOps: AADSTS650052: The app is trying to access a service/),
    });
    expect(lastError.detail).not.toMatch(/Trace ID/);
  });

  it("explains a refused token exchange from the provider's own reply", async () => {
    tokenReply = 400;
    tokenErrorBody = { error: "invalid_scope", error_description: "The requested scope is invalid, unknown, or malformed." };
    const cookie = await failedConnect("gitlab", {});
    const { lastError } = await (await myConnections(meReq(cookie))).json();
    expect(lastError).toEqual({
      provider: "gitlab",
      message: "Brief's GitLab app is missing a permission.",
      detail: "GitLab: invalid_scope The requested scope is invalid, unknown, or malformed.",
    });
  });

  it("says nothing, and sets no cookie, when there was no failure", async () => {
    const res = await myConnections(meReq());
    expect((await res.json()).lastError).toBeNull();
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("ignores a forged cookie, and clears it", async () => {
    const payload = Buffer.from(
      JSON.stringify({ provider: "azure", code: "failed", detail: "Call +1 555 0100 to fix your account", at: Date.now() }),
      "utf8",
    ).toString("base64url");
    const real = (await failedConnect("asana", { error: "server_error" })).split(".")[1];
    for (const value of [payload, `${payload}.${real}`, "garbage"]) {
      const res = await myConnections(meReq(`${ERROR_COOKIE}=${value}`));
      expect((await res.json()).lastError).toBeNull();
      expect(clearsErrorCookie(res)).toBe(true);
    }
  });

  it("ignores an expired cookie, and another user's, and clears them", async () => {
    const f: ConnectFailure = { provider: "azure", code: "failed", reason: "AADSTS650052" };
    const old = errorCookie(f, "user_1", false, Date.now() - 11 * 60_000)!.split(";")[0];
    const theirs = errorCookie(f, "user_2", false)!.split(";")[0];
    for (const cookie of [old, theirs]) {
      const res = await myConnections(meReq(cookie));
      expect((await res.json()).lastError).toBeNull();
      expect(clearsErrorCookie(res)).toBe(true);
    }
  });
});
