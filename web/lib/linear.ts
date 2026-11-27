import { errorMessage } from "./errors";
import { clerkClient } from "@clerk/nextjs/server";
import { clerkStrategy } from "./clerk-strategies";
import { resolveName, withBriefAttribution, NO_CAPABILITIES, type IssuePatch, type IssueSearchResult, type LiveIssueLookup, type TargetDetails, type Tracker, type TrackerPriority, type UpdateResult } from "./tracker";
import { chunk } from "./ticket-sync";
import { placeEvidence } from "./ticket-body";

/** The technical logs, each video's folded on its own: Linear's collapsible section is `+++ Title` ... `+++`. */
export function withLinearDetails(description: string, details?: Array<{ title: string; markdown: string }>): string {
  const folds = (details ?? []).filter((d) => d.markdown.trim()).map((d) => `+++ ${d.title}\n\n${d.markdown.trim()}\n\n+++`);
  return folds.length ? `${description.replace(/\s+$/, "")}\n\n${folds.join("\n\n")}` : description;
}

export type LinearTok = { token: string };

/**
 * The Linear token from before Linear moved to Brief's own OAuth: the account
 * the user connected through Clerk. lib/tracker-tokens asks Brief's store
 * first and only comes here when it holds no Linear connection.
 */
export async function getLinearToken(userId: string): Promise<LinearTok | null> {
  // Clerk-vended OAuth token for the user's connected Linear account. No
  // global API-key fallback: a user who hasn't connected Linear has no token,
  // so the app honestly reports "no tracker connected" instead of silently
  // filing through a shared key.
  const client = await clerkClient().catch(() => null);
  if (!client) return null;
  try {
    const res = await client.users.getUserOauthAccessToken(
      userId,
      clerkStrategy("linear") as Parameters<typeof client.users.getUserOauthAccessToken>[1],
    );
    const t = res.data?.[0]?.token;
    if (t) return { token: t };
  } catch {
    /* not connected */
  }
  return null;
}

function authHeader(tok: LinearTok): string {
  return `Bearer ${tok.token}`;
}

const AUTH_EXPIRED =
  "Your Linear connection has expired - reconnect Linear under Settings, then retry.";

/** One entry of a GraphQL response's `errors` array. */
export type GraphQLError = {
  message: string;
  /** Response path of the failing field - for an aliased field, the alias. */
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
};

/**
 * POST a query and hand back Linear's raw `{ data, errors }` envelope. Throws
 * only when the request itself failed or the token is no longer accepted.
 * Callers that can make sense of a partial answer (getIssuesByIdentifiers)
 * read `errors` themselves; everything else goes through linearGraphQL, which
 * treats any error as fatal.
 */
export async function linearGraphQLRaw<T = unknown>(
  tok: LinearTok,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data: T | null; errors: GraphQLError[] }> {
  const r = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader(tok) },
    body: JSON.stringify({ query, variables }),
  });
  // Expired / revoked OAuth token → tell the user to reconnect, not a raw 401/403.
  if (r.status === 401 || r.status === 403) throw new Error(AUTH_EXPIRED);
  const j = (await r.json().catch(() => ({}))) as { data?: T | null; errors?: unknown };
  const errors: GraphQLError[] = Array.isArray(j.errors) ? j.errors : [];
  if (
    errors.length &&
    /authentication|unauthenticated|unauthorized|forbidden|access token|invalid token/i.test(
      JSON.stringify(errors),
    )
  ) {
    throw new Error(AUTH_EXPIRED);
  }
  // A non-JSON failure (rate limit, outage page, gateway error) parses to {}:
  // say what happened instead of handing back a silent null.
  if (!r.ok && !errors.length) {
    throw new Error(
      r.status === 429
        ? "Linear is rate-limiting requests right now. Try again in a minute."
        : `Linear API error ${r.status}`,
    );
  }
  return { data: (j.data ?? null) as T | null, errors };
}

export async function linearGraphQL<T = Record<string, unknown>>(tok: LinearTok, query: string, variables: Record<string, unknown>): Promise<T> {
  const { data, errors } = await linearGraphQLRaw<T>(tok, query, variables);
  if (errors.length) throw new Error("Linear GraphQL: " + JSON.stringify(errors));
  // No data and no errors: nothing to read. Every caller reads fields off the
  // result, so fail here with a message rather than a TypeError deep in one.
  if (data == null) throw new Error("Linear returned an empty response. Try again in a minute.");
  return data as T;
}

export interface LinearIssueInfo {
  /** The ticket's CURRENT identifier. Linear resolves a ticket by any identifier
   *  it ever had, so this differs from the requested one after a team move. */
  identifier: string;
  title: string;
  url: string;
  stateName: string;
  stateColor: string;
  stateType: string;
  createdAt: string;
  assignee?: { name: string; avatarUrl?: string };
}

/** What one batch lookup learned: the tickets Linear returned, keyed by the
 *  identifier that was ASKED for, and the ones it no longer has (deleted). */
export type LinearIssueLookup = {
  issues: Record<string, LinearIssueInfo>;
  gone: string[];
};

const ISSUE_FIELDS =
  "identifier title url createdAt state { name color type } assignee { name avatarUrl }";

/** One aliased `issue(id:)` lookup per identifier: i0, i1, … */
function issuesByIdentifierQuery(ids: string[]): string {
  const aliases = ids
    .map((id, i) => `i${i}: issue(id: ${JSON.stringify(id)}) { ${ISSUE_FIELDS} }`)
    .join("\n");
  return `query IssuesByIdentifier {\n${aliases}\n}`;
}

/** The fields ISSUE_FIELDS selects, as Linear returns them. */
type LinearIssueNode = {
  identifier: string;
  title?: string | null;
  url?: string | null;
  createdAt?: string | null;
  state?: { name?: string | null; color?: string | null; type?: string | null } | null;
  assignee?: { name: string; avatarUrl?: string | null } | null;
};

function toIssueInfo(node: LinearIssueNode): LinearIssueInfo {
  return {
    identifier: node.identifier,
    title: node.title ?? "",
    url: node.url ?? "",
    stateName: node.state?.name ?? "",
    stateColor: node.state?.color ?? "#8a8378",
    stateType: node.state?.type ?? "",
    createdAt: node.createdAt ?? "",
    assignee: node.assignee
      ? { name: node.assignee.name, avatarUrl: node.assignee.avatarUrl ?? undefined }
      : undefined,
  };
}

/** What one failing alias means for the ticket behind it. */
type AliasVerdict = "gone" | "skip";

/**
 * Attribute Linear's errors to the aliases (i0/i1/…) they belong to.
 *  - An error exactly at the alias saying the entity wasn't found → "gone":
 *    the ticket no longer exists in Linear.
 *  - Any other error under an alias (a field below it failed, a wording we
 *    don't recognise) → "skip": leave that ticket to its snapshot for this
 *    load, but don't call it deleted.
 * Returns null when an error isn't pinned to any alias (auth, rate limit,
 * malformed query): that can't be attributed to a ticket, so the caller must
 * give up on the batch instead of guessing.
 */
function aliasVerdicts(errors: GraphQLError[]): Map<number, AliasVerdict> | null {
  const out = new Map<number, AliasVerdict>();
  for (const e of errors) {
    const first = e.path?.[0];
    const m = typeof first === "string" ? /^i(\d+)$/.exec(first) : null;
    if (!m) return null;
    const idx = Number(m[1]);
    const notFound = e.path?.length === 1 && /not found/i.test(e.message ?? "");
    // "gone" wins if the same alias somehow carries several errors.
    if (notFound || !out.has(idx)) out.set(idx, notFound ? "gone" : "skip");
  }
  return out;
}

/**
 * Upper bound on round-trips per batch of 20. Linear's executor (graphql-js)
 * reports ONE failing non-null root field per response, so each deleted ticket
 * in a batch costs a round; past this many, the rest of the batch keeps its
 * snapshots for this load (and the deletions found so far are remembered, so
 * the next load starts further along).
 */
const MAX_LOOKUP_ROUNDS = 6;

/**
 * Fetch live Linear issue info for a set of issue identifiers (e.g. "RAZ-153"),
 * keyed by the identifier that was ASKED for. Builds aliased queries of up to
 * 20 ids per round-trip - larger sets are CHUNKED instead of silently dropped.
 *
 * Linear declares `issue(id:)` non-null, so a ticket that no longer exists
 * (deleted in Linear) errors its alias AND nulls the whole payload - and only
 * one such failure is reported per response. That used to take every other
 * ticket in the batch down with it: the feed then showed filing-time snapshots
 * forever. Now each round-trip learns one alias Linear can't resolve and the
 * batch is re-asked without it, until every ticket has answered or been ruled
 * gone (bounded by MAX_LOOKUP_ROUNDS). The unresolvable identifiers come back
 * in `gone` so the caller can show them as deleted.
 *
 * A ticket moved to another team answers with its NEW identifier; it stays
 * keyed by the requested one here so the caller can find it, and carries the
 * new identifier/url so the stored snapshot can follow.
 *
 * Defensive by design: de-dupes ids and returns what it has on ANY failure - a
 * Linear outage or token problem must never break the dashboard render.
 */
export async function getIssuesByIdentifiers(
  tok: LinearTok,
  identifiers: string[],
): Promise<LinearIssueLookup> {
  const issues: Record<string, LinearIssueInfo> = {};
  const gone: string[] = [];
  const unanswered: string[] = [];
  const skipped: string[] = [];
  try {
    const ids = Array.from(new Set(identifiers.filter(Boolean)));
    for (const batch of chunk(ids, 20)) {
      let pending = batch;
      let rounds = 0;
      while (pending.length && rounds++ < MAX_LOOKUP_ROUNDS) {
        const { data, errors } = await linearGraphQLRaw<Record<string, LinearIssueNode | null>>(
          tok,
          issuesByIdentifierQuery(pending),
          {},
        );
        const verdicts = aliasVerdicts(errors);
        if (!verdicts) throw new Error("Linear GraphQL: " + JSON.stringify(errors));

        const retry: string[] = [];
        pending.forEach((id, i) => {
          const node = data?.[`i${i}`];
          const verdict = verdicts.get(i);
          if (node?.identifier) issues[id] = toIssueInfo(node);
          else if (verdict === "gone") gone.push(id);
          else if (verdict === "skip") skipped.push(id); // keeps its snapshot for this load
          else retry.push(id); // nulled by a sibling's error - ask again without it
        });
        if (verdicts.size === 0) {
          // Nothing failed, so nothing to remove - whatever is still empty
          // won't resolve by asking again.
          unanswered.push(...retry);
          pending = [];
          break;
        }
        pending = retry;
      }
      if (pending.length) {
        console.warn(
          `[linear] ${pending.length} ticket(s) kept their snapshot this load: round budget spent on deletions`,
        );
      }
    }
  } catch (err) {
    console.warn("[linear] live ticket sync failed:", err instanceof Error ? err.message : err);
  }
  if (skipped.length) {
    console.warn(
      `[linear] ${skipped.length} ticket(s) errored below their alias and kept their snapshot: ${skipped.join(", ")}`,
    );
  }
  if (unanswered.length) {
    console.warn(`[linear] ${unanswered.length} ticket(s) came back empty without an error: ${unanswered.join(", ")}`);
  }
  return { issues, gone };
}

export interface LinearApi {
  listTeams(): Promise<Array<{ id: string; name: string; key: string }>>;
  createIssue(
    input: {
      teamId: string;
      title: string;
      description: string;
      labelIds?: string[];
      priority?: number;
      stateId?: string;
      assigneeId?: string;
      projectId?: string;
    } & Record<string, unknown>,
  ): Promise<{ id: string; identifier: string; url: string; title: string }>;
  // Post a comment on an existing issue (markdown body).
  createComment(issueId: string, body: string): Promise<void>;
  // Upload a file to Linear's asset storage and return its public asset URL.
  uploadAsset(input: { filename: string; contentType: string; bytes: Buffer }): Promise<string>;
}

export function makeLinearApi(tok: LinearTok): LinearApi {
  return {
    async listTeams() {
      const d = await linearGraphQL<{ teams: { nodes: Array<{ id: string; name: string; key: string }> } }>(tok, `query { teams { nodes { id name key } } }`, {});
      return d.teams.nodes;
    },
    async createIssue(input) {
      const d = await linearGraphQL<{ issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string; title: string } } }>(
        tok,
        `mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url title } } }`,
        { input }
      );
      if (!d.issueCreate?.success) throw new Error("Linear issueCreate returned success=false");
      return d.issueCreate.issue;
    },
    async createComment(issueId, body) {
      const d = await linearGraphQL<{ commentCreate: { success: boolean } }>(
        tok,
        `mutation CommentCreate($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`,
        { input: { issueId, body } },
      );
      if (!d.commentCreate?.success) throw new Error("Linear commentCreate returned success=false");
    },
    async uploadAsset({ filename, contentType, bytes }) {
      const size = bytes.length;
      const d = await linearGraphQL<{
        fileUpload: { success: boolean; uploadFile: { uploadUrl: string; assetUrl: string; headers: Array<{ key: string; value: string }> } };
      }>(
        tok,
        `mutation FileUpload($filename: String!, $contentType: String!, $size: Int!) {
          fileUpload(filename: $filename, contentType: $contentType, size: $size) {
            success
            uploadFile { uploadUrl assetUrl headers { key value } }
          }
        }`,
        { filename, contentType, size }
      );
      const uf = d.fileUpload?.uploadFile;
      if (!d.fileUpload?.success || !uf) throw new Error("Linear fileUpload init failed");
      const headers: Record<string, string> = { "Content-Type": contentType };
      for (const h of uf.headers ?? []) headers[h.key] = h.value;
      const put = await fetch(uf.uploadUrl, { method: "PUT", headers, body: new Uint8Array(bytes) });
      if (!put.ok) throw new Error(`Linear asset PUT failed: ${put.status}`);
      return uf.assetUrl;
    },
  };
}

export interface LinearCustomer {
  id: string;
  name: string;
  domains: string[];
}

/**
 * The customer a free-text value names: "Acme", "acme.com",
 * "https://www.acme.com/x" or "jane@acme.com". Exact name or domain first,
 * then the forgiving name match the other fields use.
 */
export function resolveCustomer(want: string, list: LinearCustomer[]): LinearCustomer | undefined {
  const w = want.trim().toLowerCase();
  if (!w) return undefined;
  const domain = w
    .replace(/^.*@/, "")
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");
  const byName = list.find((c) => c.name.toLowerCase() === w);
  if (byName) return byName;
  const byDomain = list.find((c) => (c.domains ?? []).some((d) => d.toLowerCase().replace(/^www\./, "") === domain));
  if (byDomain) return byDomain;
  const canonical = resolveName(want, list.map((c) => c.name));
  return canonical ? list.find((c) => c.name === canonical) : undefined;
}

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The customers a ticket's text mentions: by name as a whole word ("Acme
 * Corp", not "acmecorp"), or by domain, subdomains included ("app.acme.com"
 * names acme.com). Names under 3 characters are too ambiguous to match. At
 * most 3, in list order - a ticket naming more is about something else.
 */
export function detectCustomers(text: string, list: LinearCustomer[]): LinearCustomer[] {
  if (!text.trim() || !list.length) return [];
  const found = list.filter((c) => {
    const name = c.name.trim();
    if (name.length >= 3 && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, "iu").test(text)) return true;
    return (c.domains ?? []).some((d) => {
      const dom = d.trim().toLowerCase().replace(/^www\./, "");
      return dom.includes(".") && new RegExp(`(?<![a-z0-9-])${escapeRe(dom)}(?![a-z0-9-]|\\.[a-z])`, "i").test(text);
    });
  });
  return found.slice(0, 3);
}

/** Linear numeric priority for our normalized names (0 = none). */
const LINEAR_PRIORITY: Record<TrackerPriority, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

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

type TeamMeta = {
  name: string;
  key: string;
  description: string;
  states: Array<{ id: string; name: string }>;
  labels: Array<{ id: string; name: string }>; // workspace + this team's labels
  projects: Array<{ id: string; name: string }>;
};

// Provider-agnostic adapter. Reuses makeLinearApi's upload+embed behaviour so
// Linear tickets keep their inline images.
export function makeLinearTracker(tok: LinearTok): Tracker {
  const api = makeLinearApi(tok);

  // Teams with their workflow states + usable labels, fetched once per run and
  // reused by fileIssue to resolve the names the agent passes into real ids.
  let teamMeta: Map<string, TeamMeta> | null = null;
  async function loadTeamMeta(): Promise<Map<string, TeamMeta>> {
    if (teamMeta) return teamMeta;
    const d = await linearGraphQL<{
      teams: { nodes: Array<{ id: string; name: string; key: string; description: string | null; states: { nodes: Array<{ id: string; name: string }> }; labels: { nodes: Array<{ id: string; name: string }> }; projects: { nodes: Array<{ id: string; name: string }> } }> };
      issueLabels: { nodes: Array<{ id: string; name: string; team: { id: string } | null }> };
    }>(
      tok,
      `query TeamsWithMeta {
        teams { nodes { id name key description states { nodes { id name } } labels { nodes { id name } } projects(first: 50) { nodes { id name } } } }
        issueLabels(first: 250) { nodes { id name team { id } } }
      }`,
      {},
    );
    const workspaceLabels = (d.issueLabels?.nodes ?? []).filter((l) => !l.team);
    teamMeta = new Map(
      (d.teams?.nodes ?? []).map((t) => [
        t.id,
        {
          name: t.name,
          key: t.key,
          description: t.description ?? "",
          states: t.states?.nodes ?? [],
          labels: [...workspaceLabels, ...(t.labels?.nodes ?? [])],
          projects: t.projects?.nodes ?? [],
        },
      ]),
    );
    return teamMeta;
  }

  // Workspace members (assignable), fetched once and reused to resolve an
  // "assign to X" preference into a real user id. Includes bot users like Devin.
  let users: Array<{ id: string; name: string; displayName: string; email: string }> | null = null;
  async function loadUsers() {
    if (users) return users;
    try {
      const d = await linearGraphQL<{
        users: { nodes: Array<{ id: string; name: string; displayName: string; email: string; active: boolean }> };
      }>(tok, `query { users(first: 250) { nodes { id name displayName email active } } }`, {});
      users = (d.users?.nodes ?? []).filter((u) => u.active);
    } catch {
      users = [];
    }
    return users;
  }

  // Resolve a free-text assignee ("Devin", "jane@co.com", "Jane D") to a user id.
  // Exact email/name first, then a forgiving contains-match on name/displayName.
  function resolveAssignee(
    want: string,
    list: Array<{ id: string; name: string; displayName: string; email: string }>,
  ): string | undefined {
    const w = want.trim().toLowerCase();
    if (!w) return undefined;
    const exact = list.find(
      (u) =>
        u.email?.toLowerCase() === w ||
        u.name?.toLowerCase() === w ||
        u.displayName?.toLowerCase() === w,
    );
    if (exact) return exact.id;
    const partial = list.find(
      (u) =>
        u.name?.toLowerCase().includes(w) ||
        u.displayName?.toLowerCase().includes(w) ||
        u.email?.toLowerCase().split("@")[0] === w,
    );
    return partial?.id;
  }

  // The workspace's customers (Linear "Customer requests"). Empty when the
  // workspace hasn't turned the feature on, or the token can't read them -
  // linking a customer is then simply not offered.
  let customers: LinearCustomer[] | null = null;
  async function loadCustomers(): Promise<LinearCustomer[]> {
    if (customers) return customers;
    try {
      const d = await linearGraphQL<{ customers: { nodes: LinearCustomer[] } }>(
        tok,
        `query Customers { customers(first: 250) { nodes { id name domains } } }`,
        {},
      );
      customers = d.customers?.nodes ?? [];
    } catch (err) {
      console.warn("[linear-tracker] customers unavailable:", errorMessage(err));
      customers = [];
    }
    return customers;
  }

  /** Adds a customer request (need) linking `issueId` to the customer `want` names. */
  async function linkCustomer(issueId: string, want: string, body?: string): Promise<UpdateResult> {
    const list = await loadCustomers();
    const found = resolveCustomer(want, list);
    if (!found) {
      return {
        ok: false,
        error: list.length
          ? `no customer matched "${want}". Customers: ${list.map((c) => c.name).slice(0, 60).join(", ")}`
          : "this Linear workspace has no customers (Customer requests may be turned off)",
      };
    }
    const r = await linearGraphQL<{ customerNeedCreate: { success: boolean } }>(
      tok,
      `mutation NeedCreate($input: CustomerNeedCreateInput!) { customerNeedCreate(input: $input) { success } }`,
      { input: { issueId, customerId: found.id, ...(body ? { body } : {}) } },
    );
    if (!r.customerNeedCreate?.success) return { ok: false, error: "Linear customerNeedCreate returned success=false" };
    return { ok: true };
  }

  return {
    kind: "linear",
    targetNoun: "team",
    capabilities: {
      ...NO_CAPABILITIES,
      projects: true,
      states: true,
      priority: true,
      labels: true,
      comments: true,
      nativeAttachments: true,
      customers: true,
    },
    async listTargets() {
      // Include each team's labels/states + the workspace members so the agent
      // can apply ticket preferences (e.g. "label inbound", "status Backlog",
      // "assign to Devin") with real names instead of guessing.
      const [d, members] = await Promise.all([loadTeamMeta(), loadUsers()]);
      const assignees = members.map((u) => u.displayName || u.name).filter(Boolean);
      return [...d.entries()].map(([id, meta]) => ({
        id,
        key: meta.key,
        name: meta.name,
        description: meta.description || undefined,
        labels: meta.labels.map((l) => l.name),
        states: meta.states.map((s) => s.name),
        assignees,
      }));
    },
    async searchIssues(query: string, opts?: { limit?: number }): Promise<IssueSearchResult[]> {
      const q = query.trim();
      if (!q) return [];
      const first = Math.min(Math.max(opts?.limit ?? 15, 1), 50);
      try {
        const d = await linearGraphQL<{ issues: { nodes: LinearSearchNode[] } }>(
          tok,
          `query IssueSearch($q: String!, $first: Int!) {
            issues(filter: { or: [{ title: { containsIgnoreCase: $q } }, { description: { containsIgnoreCase: $q } }] }, first: $first, orderBy: updatedAt) {
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
    async getTargetDetails(targetId): Promise<TargetDetails> {
      const [d, members, custs] = await Promise.all([loadTeamMeta(), loadUsers(), loadCustomers()]);
      const meta = d.get(targetId);
      if (!meta) {
        const known = [...d.entries()].map(([id, m]) => `${m.name} (id: ${id})`).join(", ");
        throw new Error(`Linear: team ${targetId} not found. Known teams: ${known}`);
      }
      return {
        id: targetId,
        key: meta.key,
        name: meta.name,
        description: meta.description || undefined,
        states: meta.states.map((s) => s.name),
        labels: meta.labels.map((l) => l.name),
        members: members.map((u) => u.displayName || u.name).filter(Boolean),
        projects: meta.projects.map((p) => ({ id: p.id, name: p.name })),
        ...(custs.length ? { customers: custs.map((c) => ({ name: c.name, domains: c.domains ?? [] })) } : {}),
      };
    },
    async fileIssue({ targetId, title, descriptionMarkdown, labels, priority, state, assignee, project, customer, comment, extraFields, evidence, details }) {
      let description = descriptionMarkdown;
      // Upload each evidence file and embed it inline (Linear-hosted asset URL).
      const embeds: string[] = [];
      let imgN = 0;
      for (const e of evidence) {
        try {
          const assetUrl = await api.uploadAsset({ filename: e.filename, contentType: e.contentType, bytes: e.bytes });
          if (e.contentType.startsWith("image/")) {
            imgN += 1;
            // The agent's one-line description renders directly above the image,
            // so each screenshot reads as "<what it shows>" then the picture.
            const cap = e.caption && e.caption.trim() ? `${e.caption.trim()}\n\n` : "";
            embeds.push(`${cap}![Screenshot ${imgN}](${assetUrl})`);
          } else {
            // Recording: a bare URL on its own line is enough - Linear renders it
            // as an inline player with its own link. Don't add a second link (that
            // made the recording show up "twice").
            // The replay, rendered to a video, says so: it isn't a screen recording.
            const label = e.filename.startsWith("replay") ? "Replay" : "Screen recording";
            embeds.push(`**${label}:**\n\n${assetUrl}`);
          }
        } catch (err) {
          console.warn("[linear-tracker] evidence upload failed:", e.filename, err);
        }
      }
      // Add the evidence only if the description doesn't already carry hosted
      // assets, and inside the agent's own Evidence section when it wrote one,
      // so the ticket never shows that heading twice.
      if (embeds.length && !description.includes("uploads.linear.app")) {
        description = placeEvidence(description, embeds.join("\n\n"));
      }
      description = withBriefAttribution(withLinearDetails(description, details));

      // Resolve the agent's label/state names to ids - best-effort, never fatal.
      let labelIds: string[] | undefined;
      let stateId: string | undefined;
      try {
        const meta = (await loadTeamMeta()).get(targetId);
        const norm = (s: string) => s.trim().toLowerCase();
        if (labels?.length && meta) {
          const ids: string[] = [];
          for (const want of labels) {
            const found = meta.labels.find((l) => norm(l.name) === norm(want));
            if (found) {
              ids.push(found.id);
              continue;
            }
            // The user's preferences may name a label that doesn't exist yet
            // ("label every ticket inbound") - create it on the team so the
            // preference is honored instead of silently dropped.
            try {
              const c = await linearGraphQL<{ issueLabelCreate: { success: boolean; issueLabel: { id: string } } }>(
                tok,
                `mutation LabelCreate($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { success issueLabel { id } } }`,
                { input: { name: want.trim(), teamId: targetId } },
              );
              if (c.issueLabelCreate?.success) ids.push(c.issueLabelCreate.issueLabel.id);
            } catch (err) {
              console.warn("[linear-tracker] label create failed:", want, err);
            }
          }
          if (ids.length) labelIds = ids;
        }
        if (state && meta) {
          const canonical = resolveName(state, meta.states.map((s) => s.name));
          stateId = meta.states.find((s) => s.name === canonical)?.id;
        }
      } catch (err) {
        console.warn("[linear-tracker] label/state resolution failed:", err);
      }

      // Resolve the project preference ("file under Mobile app") to a projectId.
      let projectId: string | undefined;
      if (project) {
        try {
          const meta = (await loadTeamMeta()).get(targetId);
          const byId = meta?.projects.find((p) => p.id === project);
          const canonical = byId?.name ?? resolveName(project, meta?.projects.map((p) => p.name) ?? []);
          projectId = byId?.id ?? meta?.projects.find((p) => p.name === canonical)?.id;
          if (!projectId) console.warn(`[linear-tracker] no project matched "${project}"`);
        } catch (err) {
          console.warn("[linear-tracker] project resolution failed:", err);
        }
      }

      // Resolve the assignee name → user id (best-effort, never fatal).
      let assigneeId: string | undefined;
      if (assignee) {
        try {
          assigneeId = resolveAssignee(assignee, await loadUsers());
          if (!assigneeId) console.warn(`[linear-tracker] no member matched assignee "${assignee}"`);
        } catch (err) {
          console.warn("[linear-tracker] assignee resolution failed:", err);
        }
      }

      const issue = await api.createIssue({
        // Raw passthrough first - resolved fields always win on conflict.
        ...(extraFields ?? {}),
        teamId: targetId,
        title,
        description,
        ...(labelIds ? { labelIds } : {}),
        ...(priority && LINEAR_PRIORITY[priority] ? { priority: LINEAR_PRIORITY[priority] } : {}),
        ...(stateId ? { stateId } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(projectId ? { projectId } : {}),
      });

      // Post the requested comment after the issue exists (best-effort).
      if (comment?.trim()) {
        try {
          await api.createComment(issue.id, comment.trim());
        } catch (err) {
          console.warn("[linear-tracker] comment post failed:", err);
        }
      }

      // Link the customer it was reported for, as a customer request
      // (best-effort). The agent's pick wins; without one, any customer the
      // ticket mentions by name or domain is linked by default.
      try {
        const wanted = customer?.trim()
          ? [customer.trim()]
          : detectCustomers(`${title}
${descriptionMarkdown}`, await loadCustomers()).map((c) => c.name);
        for (const want of wanted) {
          const r = await linkCustomer(issue.id, want, title);
          if (!r.ok) console.warn("[linear-tracker] customer link failed:", r.error);
        }
      } catch (err) {
        console.warn("[linear-tracker] customer link failed:", err);
      }

      return { id: issue.id, identifier: issue.identifier, url: issue.url, title: issue.title };
    },
    async updateIssue(identifier, patch: IssuePatch): Promise<UpdateResult> {
      try {
        // Linear's issue(id:) accepts the human identifier ("RAZ-12") too.
        const d = await linearGraphQL<{ issue: { id: string; team: { id: string } } | null }>(
          tok,
          `query IssueRef($id: String!) { issue(id: $id) { id team { id } } }`,
          { id: identifier },
        );
        if (!d.issue) return { ok: false, error: `issue ${identifier} not found` };
        const meta = (await loadTeamMeta()).get(d.issue.team.id);

        const input: Record<string, unknown> = { ...(patch.extraFields ?? {}) };
        if (patch.title) input.title = patch.title;
        if (patch.priority && LINEAR_PRIORITY[patch.priority]) input.priority = LINEAR_PRIORITY[patch.priority];
        if (patch.state) {
          const names = meta?.states.map((s) => s.name) ?? [];
          const canonical = resolveName(patch.state, names);
          const id = meta?.states.find((s) => s.name === canonical)?.id;
          if (!id) return { ok: false, error: `state "${patch.state}" not found. Valid states: ${names.join(", ")}` };
          input.stateId = id;
        }
        if (patch.assignee) {
          const users = await loadUsers();
          const id = resolveAssignee(patch.assignee, users);
          if (!id) {
            const names = users.map((u) => u.displayName || u.name).join(", ");
            return { ok: false, error: `no member matched "${patch.assignee}". Members: ${names}` };
          }
          input.assigneeId = id;
        }
        if (patch.project) {
          const projects = meta?.projects ?? [];
          const byId = projects.find((p) => p.id === patch.project);
          const canonical = byId?.name ?? resolveName(patch.project, projects.map((p) => p.name));
          const id = byId?.id ?? projects.find((p) => p.name === canonical)?.id;
          if (!id) return { ok: false, error: `project "${patch.project}" not found. Projects: ${projects.map((p) => p.name).join(", ") || "(none in this team)"}` };
          input.projectId = id;
        }
        if (patch.labels?.length && meta) {
          const ids: string[] = [];
          const missing: string[] = [];
          for (const want of patch.labels) {
            const canonical = resolveName(want, meta.labels.map((l) => l.name));
            const id = meta.labels.find((l) => l.name === canonical)?.id;
            if (id) ids.push(id);
            else missing.push(want);
          }
          if (missing.length) return { ok: false, error: `labels not found: ${missing.join(", ")}. Valid labels: ${meta.labels.map((l) => l.name).join(", ")}` };
          input.labelIds = ids;
        }
        if (patch.customer) {
          const linked = await linkCustomer(d.issue.id, patch.customer);
          if (!linked.ok) return linked;
          if (!Object.keys(input).length) return { ok: true };
        }
        if (!Object.keys(input).length) return { ok: false, error: "nothing to update" };

        const r = await linearGraphQL<{ issueUpdate: { success: boolean } }>(
          tok,
          `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`,
          { id: d.issue.id, input },
        );
        if (!r.issueUpdate?.success) return { ok: false, error: "Linear issueUpdate returned success=false" };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },
    async getIssue(identifier) {
      const d = await linearGraphQL<{
        issue: {
          identifier: string; title: string; url: string; priority: number | null;
          state?: { name?: string; color?: string } | null;
          assignee?: { name?: string; displayName?: string } | null;
          labels?: { nodes?: Array<{ name: string }> } | null;
          project?: { name?: string } | null;
          needs?: { nodes?: Array<{ customer?: { name?: string } | null }> } | null;
        } | null;
      }>(
        tok,
        `query IssueRead($id: String!) {
          issue(id: $id) {
            identifier title url priority
            state { name color }
            assignee { name displayName }
            labels { nodes { name } }
            project { name }
            needs(first: 20) { nodes { customer { name } } }
          }
        }`,
        { id: identifier },
      );
      const i = d.issue;
      if (!i) throw new Error(`issue ${identifier} not found`);
      const priorityName = (Object.entries(LINEAR_PRIORITY).find(([, v]) => v === i.priority) ?? [null])[0];
      return {
        identifier: i.identifier,
        title: i.title,
        url: i.url,
        state: i.state?.name ?? null,
        stateColor: i.state?.color ?? null,
        assignee: i.assignee?.displayName || i.assignee?.name || null,
        labels: (i.labels?.nodes ?? []).map((l) => l.name),
        project: i.project?.name ?? null,
        priority: priorityName,
        customers: (i.needs?.nodes ?? []).map((n) => n.customer?.name).filter(Boolean),
      };
    },
    async getLiveIssues(identifiers): Promise<LiveIssueLookup> {
      // getIssuesByIdentifiers already distinguishes "Linear says this is gone"
      // from "the lookup failed", which is exactly the `gone` contract.
      const { issues, gone } = await getIssuesByIdentifiers(tok, identifiers);
      return { issues, gone };
    },
  };
}

/**
 * The workspace this token belongs to - Brief's org identity for Linear.
 *
 * A Linear token is scoped to exactly one organization, so this is unambiguous:
 * two users whose tokens return the same id are, by definition, colleagues.
 */
export async function getLinearOrg(
  tok: LinearTok,
): Promise<{ id: string; name: string } | null> {
  const d = await linearGraphQL<{ organization?: { id?: string; name?: string } }>(
    tok,
    `query { organization { id name } }`,
    {},
  );
  const org = d?.organization;
  return org?.id ? { id: org.id, name: org.name ?? "Linear workspace" } : null;
}
