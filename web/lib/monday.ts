import { errorMessage } from "./errors";
import {
  UNSETTABLE_TYPES,
  buildMondayBody,
  columnLabels,
  extraColumnValue,
  firstPerson,
  itemColumns,
  mondayHtml,
  mondayStateColor,
  peopleColumn,
  pickPriorityLabel,
  priorityColumn,
  statusColumn,
  stripHtml,
  type MondayColumn,
  type RawColumnValue,
} from "./monday-body";
import {
  NO_CAPABILITIES,
  STATUS_COLOR,
  resolveName,
  withBriefAttribution,
  type IssueInput,
  type IssuePatch,
  type IssueSearchResult,
  type LiveIssue,
  type LiveIssueLookup,
  type TargetDetails,
  type Tracker,
  type TrackerPriority,
  type TrackerTarget,
  type UpdateResult,
  type Workspace,
} from "./tracker";
import { chunk } from "./ticket-sync";
import { evidenceFileName, evidenceIndexes, technicalLogsFile } from "./ticket-body";

/**
 * A monday.com token. Brief's own OAuth app hands out tokens that never
 * expire, and a personal API token from the developer center behaves exactly
 * the same way, which is what the live test uses.
 */
export type MondayTok = { token: string };

const API = "https://api.monday.com/v2";
const FILE_API = "https://api.monday.com/v2/file";
/**
 * Pinned, because monday changes response shapes between versions (2025-01
 * rewrote the error format) and an unpinned client silently follows along.
 * 2026-07 is the version monday's versioning page lists as Current (the
 * default when no header is sent) as of October 2026. Every query here was
 * checked against its published schema; the one deprecation it reports is
 * Column.settings_str, still served, see BOARD_QUERY.
 */
const API_VERSION = "2026-07";

const AUTH_EXPIRED =
  "Your Monday connection has expired - reconnect Monday under Settings, then retry.";

// ---------------------------------------------------------------------------
// GraphQL helpers
// ---------------------------------------------------------------------------

type MondayErrorEntry = { message?: string; extensions?: { code?: string; status_code?: number } };

/** Both error shapes monday has used: the GraphQL `errors[]`, and the older top-level `error_message`. */
type MondayEnvelope<T> = {
  data?: T | null;
  errors?: MondayErrorEntry[];
  error_message?: string;
  error_code?: string;
  status_code?: number;
};

/**
 * An error monday answered with. It carries monday's error code and the HTTP
 * status so a caller can tell "monday refused this value" (safe to change the
 * request and try again) from an outage, where the first request may well
 * have gone through and repeating it would file the item twice.
 */
export class MondayApiError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly status: number,
  ) {
    super(message);
    this.name = "MondayApiError";
  }
}

/** Codes monday uses when a column value, not the request as a whole, is what it refused. */
const COLUMN_VALUE_REJECTIONS = new Set([
  "ColumnValueException",
  "CorrectedValueException",
  "InvalidColumnIdException",
  "InvalidUserIdException",
]);

function isColumnValueRejection(err: unknown): boolean {
  return err instanceof MondayApiError && !!err.code && COLUMN_VALUE_REJECTIONS.has(err.code);
}

/** Codes that mean "not now" rather than "not this request", whatever HTTP status carried them. */
const THROTTLED = new Set([
  "COMPLEXITY_BUDGET_EXHAUSTED",
  "Rate Limit Exceeded",
  "IP_RATE_LIMIT_EXCEEDED",
  "maxConcurrencyExceeded",
  "API_TEMPORARILY_BLOCKED",
]);

/**
 * True when monday read the request and refused something in it, as opposed
 * to an outage, a throttle or a refused token. Only then can asking about
 * fewer ids at a time get a different answer.
 */
function isRequestRejection(err: unknown): boolean {
  if (!(err instanceof MondayApiError)) return false;
  if (err.code && THROTTLED.has(err.code)) return false;
  return err.status === 200 || (err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 429);
}

function authHeaders(tok: MondayTok): Record<string, string> {
  // monday takes the bare token, OAuth or personal, with no "Bearer" scheme.
  return { Authorization: tok.token, "API-Version": API_VERSION };
}

/**
 * Read monday's answer and throw its own message on any error.
 *
 * Since 2025-01 an application error (a bad column value, an unknown board)
 * comes back as HTTP 200 with an `errors` array, so the status code alone
 * says nothing. The message is what the agent needs to correct itself.
 */
async function readEnvelope<T>(r: Response): Promise<T> {
  const j = (await r.json().catch(() => ({}))) as MondayEnvelope<T>;
  const errors = Array.isArray(j.errors) ? j.errors : [];
  // Only a real authentication failure means "reconnect". A
  // UserUnauthorizedException is a permission on one board, and telling the
  // user to reconnect for that would send them in circles.
  const unauthenticated =
    r.status === 401 ||
    j.status_code === 401 ||
    errors.some((e) => e?.extensions?.status_code === 401) ||
    errors.some((e) => /^(not authenticated|unauthorized)$/i.test((e?.message ?? "").trim()));
  if (unauthenticated) throw new Error(AUTH_EXPIRED);

  const messages = errors.map((e) => e?.message?.trim()).filter((m): m is string => !!m);
  if (j.error_message?.trim()) messages.push(j.error_message.trim());
  if (messages.length) {
    const code = errors.find((e) => e?.extensions?.code)?.extensions?.code ?? j.error_code;
    throw new MondayApiError(`Monday: ${messages.join("; ")}`, code, r.status);
  }
  if (!r.ok) {
    throw new MondayApiError(
      r.status === 429
        ? "Monday is rate-limiting requests right now. Try again in a minute."
        : `Monday API error ${r.status}`,
      undefined,
      r.status,
    );
  }
  // Every caller reads fields off the result, so fail here with a message
  // rather than a TypeError deep inside one of them.
  if (j.data == null) throw new Error("Monday returned an empty response. Try again in a minute.");
  return j.data;
}

async function mondayGraphQL<T>(
  tok: MondayTok,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const r = await fetch(API, {
    method: "POST",
    headers: { ...authHeaders(tok), "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return readEnvelope<T>(r);
}

/**
 * Upload one file through monday's multipart endpoint. The convention there is
 * a `query` field holding the mutation and the bytes under `variables[file]`,
 * which binds to the mutation's `$file` variable. No Content-Type is set by
 * hand: fetch has to write the multipart boundary itself.
 */
async function mondayUpload(
  tok: MondayTok,
  query: string,
  file: { name: string; contentType: string; bytes: Buffer },
): Promise<void> {
  const form = new FormData();
  form.append("query", query);
  form.append(
    "variables[file]",
    new Blob([new Uint8Array(file.bytes)], { type: file.contentType }),
    file.name,
  );
  const r = await fetch(FILE_API, { method: "POST", headers: authHeaders(tok), body: form });
  await readEnvelope(r);
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

type MeAccount = { id: string | number; name: string; slug?: string | null };

const ME_QUERY = `query { me { account { id name slug } } }`;

/**
 * The account this token belongs to, for the workspace pick. A monday token is
 * issued for exactly one account, so this is always one entry (or none when
 * the token no longer works).
 */
export async function listMondayAccount(tok: MondayTok): Promise<Workspace[]> {
  try {
    const d = await mondayGraphQL<{ me?: { account?: MeAccount | null } | null }>(tok, ME_QUERY);
    const a = d.me?.account;
    return a ? [{ id: String(a.id), name: a.name }] : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tracker implementation
// ---------------------------------------------------------------------------

type BoardRaw = {
  id: string;
  name: string;
  description?: string | null;
  type?: string | null;
  workspace?: { name?: string | null } | null;
};

type Board = {
  id: string;
  name: string;
  description?: string | null;
  columns: MondayColumn[];
  groups: Array<{ id: string; title: string }>;
  subscribers: Array<{ id: string; name: string }>;
};

type MondayUser = { id: string; name: string; email?: string | null };

type ItemRaw = {
  id: string;
  name: string;
  url?: string | null;
  state?: string | null;
  created_at?: string | null;
  board?: { id: string; name?: string | null } | null;
  group?: { title?: string | null } | null;
  column_values?: RawColumnValue[] | null;
};

const TARGETS_QUERY = `query {
  boards(limit: 100, state: active, order_by: used_at) {
    id name description type workspace { name }
  }
}`;

// settings_str is deprecated from 2025-10 in favor of a `settings` JSON field,
// but 2026-07 still serves it, and its shape is the one columnLabels is tested
// against. Moving to `settings` should wait for a live check of its shape.
const BOARD_QUERY = `query ($ids: [ID!]) {
  boards(ids: $ids) {
    id name description
    columns { id title type settings_str }
    groups { id title }
    subscribers { id name }
  }
}`;

// monday filters users on its side, so the adapter never has to page through
// a large account to find one person.
const USERS_BY_EMAIL = `query ($emails: [String!]) { users(emails: $emails, limit: 10) { id name email } }`;
const USERS_BY_NAME = `query ($name: String) { users(name: $name, limit: 50) { id name email } }`;

const CREATE_ITEM = `mutation ($board: ID!, $group: String, $name: String!, $cols: JSON) {
  create_item(board_id: $board, group_id: $group, item_name: $name, column_values: $cols, create_labels_if_missing: false) { id url }
}`;

const CREATE_UPDATE = `mutation ($item: ID!, $body: String!) {
  create_update(item_id: $item, body: $body) { id }
}`;

const CREATE_REPLY = `mutation ($item: ID!, $parent: ID!, $body: String!) {
  create_update(item_id: $item, parent_id: $parent, body: $body) { id }
}`;

const DELETE_ITEM = `mutation ($item: ID!) { delete_item(item_id: $item) { id } }`;

const ITEM_BOARD_QUERY = `query ($ids: [ID!]) { items(ids: $ids) { id board { id } } }`;

const CHANGE_VALUES = `mutation ($item: ID!, $board: ID!, $cols: JSON!) {
  change_multiple_column_values(item_id: $item, board_id: $board, column_values: $cols, create_labels_if_missing: false) { id }
}`;

const MOVE_TO_GROUP = `mutation ($item: ID!, $group: String!) {
  move_item_to_group(item_id: $item, group_id: $group) { id }
}`;

const ITEM_QUERY = `query ($ids: [ID!]) {
  items(ids: $ids) {
    id name url state
    board { id name }
    group { title }
    column_values { id type text column { title } }
  }
}`;

const SEARCH_QUERY = `query ($board: [ID!], $q: CompareValue!) {
  boards(ids: $board) {
    id name
    items_page(limit: 5, query_params: { rules: [{ column_id: "name", compare_value: $q, operator: contains_text }] }) {
      items { id name url group { title } column_values { id type text column { title } } }
    }
  }
}`;

// `exclude_nonactive` is left at its default (false) on purpose: the archived
// and deleted items are exactly the ones the live read needs to see.
const LIVE_QUERY = `query ($ids: [ID!]) {
  items(ids: $ids, limit: 100) {
    id name url state created_at
    board { id }
    column_values { id type text column { title } }
  }
}`;

/** monday item ids are plain integers; anything else cannot address an item. */
function parseItemId(identifier: string): string | null {
  const id = (identifier ?? "").trim().replace(/^#/, "");
  return /^\d+$/.test(id) ? id : null;
}

type ColumnFields = Pick<IssueInput, "state" | "priority" | "assignee" | "extraFields">;

export function makeMondayTracker(tok: MondayTok): Tracker {
  let targetsCache: TrackerTarget[] | null = null;
  const userCache = new Map<string, MondayUser | null>();
  const boardCache = new Map<string, Board>();
  let slugPromise: Promise<string | null> | null = null;

  async function loadTargets(): Promise<TrackerTarget[]> {
    if (targetsCache) return targetsCache;
    const d = await mondayGraphQL<{ boards?: BoardRaw[] | null }>(tok, TARGETS_QUERY);
    targetsCache = (d.boards ?? [])
      // Sub-item boards and documents are boards in the API, but an item
      // filed there is invisible from the board the team actually works in.
      .filter((b) => b.type === "board")
      .map((b) => {
        const ws = b.workspace?.name?.trim();
        return {
          id: String(b.id),
          key: b.name,
          name: ws ? `${ws} / ${b.name}` : b.name,
          description: b.description?.trim() || undefined,
        };
      });
    return targetsCache;
  }

  async function loadBoard(boardId: string): Promise<Board | null> {
    const cached = boardCache.get(boardId);
    if (cached) return cached;
    const d = await mondayGraphQL<{ boards?: Board[] | null }>(tok, BOARD_QUERY, { ids: [boardId] });
    const b = d.boards?.[0];
    if (!b) return null;
    const board: Board = {
      id: String(b.id),
      name: b.name,
      description: b.description,
      columns: b.columns ?? [],
      groups: b.groups ?? [],
      subscribers: (b.subscribers ?? []).filter(Boolean),
    };
    boardCache.set(boardId, board);
    return board;
  }

  /**
   * The account user an agent-supplied name or email refers to. An email is
   * looked up exactly; a name goes through monday's fuzzy name search, and the
   * candidates it returns must still resolve by name here, so a loose match
   * on monday's side can't assign the ticket to the wrong person.
   */
  async function findUser(want: string): Promise<MondayUser | undefined> {
    const w = want.trim().replace(/^@/, "");
    if (!w) return undefined;
    const key = w.toLowerCase();
    if (userCache.has(key)) return userCache.get(key) ?? undefined;

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(w);
    const d = isEmail
      ? await mondayGraphQL<{ users?: MondayUser[] | null }>(tok, USERS_BY_EMAIL, { emails: [w] })
      : await mondayGraphQL<{ users?: MondayUser[] | null }>(tok, USERS_BY_NAME, { name: w });
    const users = (d.users ?? []).filter(Boolean);
    const user =
      users.find((u) => u.email?.toLowerCase() === key || u.name.toLowerCase() === key) ??
      (isEmail ? undefined : users.find((u) => u.name === resolveName(w, users.map((x) => x.name))));
    userCache.set(key, user ?? null);
    return user;
  }

  /** The account slug for item links, asked for once and only when an item came back without its own url. */
  function accountSlug(): Promise<string | null> {
    slugPromise ??= mondayGraphQL<{ me?: { account?: MeAccount | null } | null }>(tok, ME_QUERY)
      .then((d) => d.me?.account?.slug ?? null)
      .catch(() => null);
    return slugPromise;
  }

  async function itemUrl(boardId: string | undefined, itemId: string, url?: string | null): Promise<string> {
    if (url) return url;
    const slug = await accountSlug();
    const host = slug ? `https://${slug}.monday.com` : "https://monday.com";
    return boardId ? `${host}/boards/${boardId}/pulses/${itemId}` : host;
  }

  function findGroup(board: Board, want: string): { id: string; title: string } | undefined {
    const w = want.trim();
    const byId = board.groups.find((g) => g.id === w);
    if (byId) return byId;
    const canonical = resolveName(w, board.groups.map((g) => g.title));
    return board.groups.find((g) => g.title === canonical);
  }

  /**
   * Turn the agent's status, priority, assignee and custom fields into one
   * `column_values` object. Every value that cannot be resolved becomes an
   * error message naming the valid options instead: fileIssue logs and skips
   * them, updateIssue reports them, from the same code.
   */
  async function buildColumnValues(
    board: Board,
    f: ColumnFields,
  ): Promise<{ values: Record<string, unknown>; errors: string[] }> {
    const values: Record<string, unknown> = {};
    const errors: string[] = [];
    const cols = board.columns;

    if (f.state?.trim()) {
      const col = statusColumn(cols);
      const labels = col ? columnLabels(col) : [];
      const label = resolveName(f.state, labels);
      if (!col) errors.push(`This board has no Status column, so a status cannot be set.`);
      else if (!label) errors.push(`Unknown status "${f.state}". Valid: ${labels.join(", ")}`);
      else values[col.id] = { label };
    }

    if (f.priority) {
      const col = priorityColumn(cols);
      const labels = col ? columnLabels(col) : [];
      const label = pickPriorityLabel(f.priority, labels);
      if (!col) errors.push(`This board has no Priority column, so a priority cannot be set.`);
      else if (!label) errors.push(`Unknown priority "${f.priority}". Valid: ${labels.join(", ")}`);
      else values[col.id] = { label };
    }

    if (f.assignee?.trim()) {
      const col = peopleColumn(cols);
      if (!col) {
        errors.push(`This board has no People column, so an assignee cannot be set.`);
      } else {
        try {
          const user = await findUser(f.assignee);
          if (user) {
            // monday's own examples send the person id as a number.
            const id = /^\d+$/.test(String(user.id)) ? Number(user.id) : user.id;
            values[col.id] = { personsAndTeams: [{ id, kind: "person" }] };
          } else {
            const names = board.subscribers.map((s) => s.name).slice(0, 50);
            errors.push(
              names.length
                ? `Unknown person "${f.assignee}". Valid: ${names.join(", ")}`
                : `Unknown person "${f.assignee}": no one by that name or email on this monday account.`,
            );
          }
        } catch (e) {
          errors.push(`Could not look up "${f.assignee}": ${errorMessage(e)}`);
        }
      }
    }

    for (const [key, v] of Object.entries(f.extraFields ?? {})) {
      if (v === undefined || v === null || v === "") continue;
      const k = key.trim();
      const col =
        cols.find((c) => c.id === k) ??
        cols.find((c) => c.title === k) ??
        cols.find((c) => c.title.toLowerCase() === k.toLowerCase());
      if (!col || UNSETTABLE_TYPES.has(col.type) || col.id === "name") {
        const valid = cols.filter((c) => !UNSETTABLE_TYPES.has(c.type) && c.id !== "name");
        errors.push(`Unknown column "${key}". Valid: ${valid.map((c) => c.title).join(", ")}`);
        continue;
      }
      const r = extraColumnValue(col, v);
      if (r.error) errors.push(r.error);
      else values[col.id] = r.value;
    }

    return { values, errors };
  }

  return {
    kind: "monday",
    targetNoun: "board",
    capabilities: {
      ...NO_CAPABILITIES,
      // Groups split a board the way projects split a Linear team.
      projects: true,
      // Status and priority are status-type columns, resolved per board.
      states: true,
      priority: true,
      customFields: true,
      comments: true,
      nativeAttachments: true,
    },
    bodyGuidance: "The description is posted as the item's first update.",

    async listTargets() {
      return loadTargets();
    },

    async searchIssues(query, opts): Promise<IssueSearchResult[]> {
      const q = query.trim();
      if (!q) return [];
      try {
        // monday has no account-wide item search in the API, so the search
        // runs board by board over the few boards this user touches most.
        const boards = (await loadTargets()).slice(0, 5);
        const limit = Math.min(Math.max(opts?.limit ?? 15, 1), 50);
        const perBoard = await Promise.all(
          boards.map(async (b) => {
            try {
              const d = await mondayGraphQL<{
                boards?: Array<{
                  id: string;
                  name: string;
                  items_page?: { items?: ItemRaw[] | null } | null;
                }> | null;
              }>(tok, SEARCH_QUERY, { board: [b.id], q: [q] });
              return (d.boards?.[0]?.items_page?.items ?? []).map((i) => ({ i, target: b }));
            } catch {
              // One board we can't read must not cost the others' results.
              return [];
            }
          }),
        );
        const out: IssueSearchResult[] = [];
        for (const { i, target } of perBoard.flat()) {
          const cols = itemColumns(i.column_values);
          const status = statusColumn(cols)?.text;
          const prio = priorityColumn(cols)?.text;
          const people = peopleColumn(cols)?.text;
          out.push({
            identifier: String(i.id),
            title: i.name,
            url: await itemUrl(target.id, String(i.id), i.url),
            target: target.name,
            state: status || undefined,
            assignee: people ? firstPerson(people) : undefined,
            priority: prio
              ? (["urgent", "high", "medium", "low"] as TrackerPriority[]).find(
                  (p) => pickPriorityLabel(p, [prio]) !== undefined,
                )
              : undefined,
            project: i.group?.title ?? undefined,
          });
        }
        return out.slice(0, limit);
      } catch {
        return [];
      }
    },

    async getTargetDetails(targetId): Promise<TargetDetails> {
      const board = await loadBoard(targetId);
      if (!board) {
        const known = (await loadTargets().catch(() => [] as TrackerTarget[]))
          .map((t) => `${t.name} (id: ${t.id})`)
          .join(", ");
        throw new Error(`Monday: board ${targetId} not found. Known boards: ${known}`);
      }
      const status = statusColumn(board.columns);
      const priority = priorityColumn(board.columns);
      const people = peopleColumn(board.columns);
      const handled = new Set([status?.id, priority?.id, people?.id].filter(Boolean));

      const customFields: TargetDetails["customFields"] = board.columns
        .filter((c) => c.id !== "name" && !handled.has(c.id) && !UNSETTABLE_TYPES.has(c.type))
        .map((c) => {
          const allowed = columnLabels(c);
          return {
            id: c.id,
            name: c.title,
            type: c.type,
            ...(allowed.length ? { allowedValues: allowed } : {}),
          };
        });

      return {
        id: board.id,
        key: board.name,
        name: board.name,
        description: board.description?.trim() || undefined,
        states: status ? columnLabels(status) : [],
        labels: [],
        members: board.subscribers.map((s) => s.name).filter(Boolean),
        projects: board.groups.map((g) => ({ id: g.id, name: g.title })),
        customFields,
      };
    },

    async fileIssue({
      targetId,
      title,
      descriptionMarkdown,
      priority,
      state,
      assignee,
      project,
      comment,
      extraFields,
      evidence,
      details,
    }) {
      // Status, priority, assignee, group and custom fields are best-effort:
      // a board we can't read, or a label it doesn't have, files the item
      // without them rather than failing. Labels are never created, so a typo
      // can't add a stray option to the team's status column.
      let values: Record<string, unknown> = {};
      let group: string | undefined;
      try {
        const board = await loadBoard(targetId);
        if (board) {
          const built = await buildColumnValues(board, { state, priority, assignee, extraFields });
          values = built.values;
          if (built.errors.length) {
            console.warn(`[monday-tracker] skipped on create: ${built.errors.join(" ")}`);
          }
          if (project?.trim()) group = findGroup(board, project)?.id;
        }
      } catch (err) {
        if (err instanceof Error && err.message === AUTH_EXPIRED) throw err;
        console.warn("[monday-tracker] board read failed, filing without column values:", errorMessage(err));
      }

      const create = (cols: Record<string, unknown>) =>
        mondayGraphQL<{ create_item?: { id: string; url?: string | null } | null }>(tok, CREATE_ITEM, {
          board: targetId,
          group,
          name: title,
          cols: Object.keys(cols).length ? JSON.stringify(cols) : undefined,
        });

      let created: { id: string; url?: string | null } | null | undefined;
      try {
        created = (await create(values)).create_item;
      } catch (err) {
        // A value monday rejects (a malformed custom field, a person who is
        // not on the board) fails the whole mutation, and nothing was filed.
        // The item matters more than its fields, so file it bare and let the
        // agent repair the rest. Anything else (a timeout, a 5xx, a dropped
        // connection) may have filed the item already, and filing again
        // would leave the team with two, so that error goes up as it is.
        if (!Object.keys(values).length || !isColumnValueRejection(err)) throw err;
        console.warn(`[monday-tracker] create with column values rejected, retrying without: ${errorMessage(err)}`);
        created = (await create({})).create_item;
      }
      if (!created?.id) throw new Error("Monday did not return the new item. Try again in a minute.");
      const itemId = String(created.id);

      // A monday item has no description field. The body is the item's first
      // update, and the evidence is attached to that same update so it reads
      // as one post.
      const html = mondayHtml(withBriefAttribution(buildMondayBody(descriptionMarkdown, evidence)));
      const postBody = async (body: string): Promise<string> => {
        const u = await mondayGraphQL<{ create_update?: { id: string } | null }>(tok, CREATE_UPDATE, {
          item: itemId,
          body,
        });
        if (!u.create_update?.id) throw new Error("Monday did not return the description update.");
        return String(u.create_update.id);
      };

      // An item with only a title is a ticket nobody can act on, and filing
      // "succeeded" would hide that. So: the HTML once more, then the same
      // text without tags, and if monday takes neither, the bare item is
      // removed and the filing fails where the user can see it.
      let updateId: string | undefined;
      let lastErr: unknown;
      for (const body of [html, html, stripHtml(html)]) {
        try {
          updateId = await postBody(body);
          break;
        } catch (err) {
          lastErr = err;
          console.warn("[monday-tracker] description update failed:", errorMessage(err));
        }
      }
      if (!updateId) {
        let removed = false;
        try {
          await mondayGraphQL(tok, DELETE_ITEM, { item: itemId });
          removed = true;
        } catch (err) {
          console.warn("[monday-tracker] could not remove the item left without a description:", errorMessage(err));
        }
        if (lastErr instanceof Error && lastErr.message === AUTH_EXPIRED) throw lastErr;
        throw new Error(
          removed
            ? `Monday would not take the item's description, so the item was removed: ${errorMessage(lastErr)}`
            : `Monday would not take the description of item ${itemId}, and it could not be removed: ${errorMessage(lastErr)}`,
        );
      }

      // The update id is written into the upload mutation itself (the file
      // endpoint binds only the file as a variable), so it must be digits.
      if (/^\d+$/.test(updateId)) {
        const attach = `mutation ($file: File!) { add_file_to_update(update_id: ${updateId}, file: $file) { id } }`;
        // monday shows a file's name under every attachment, so each goes up
        // under its neutral name, numbered like the Evidence list in the body.
        const indexes = evidenceIndexes(evidence);
        const files = evidence.map((e, i) => ({
          name: evidenceFileName(e.contentType, indexes[i]),
          contentType: e.contentType,
          bytes: e.bytes,
        }));
        // The logs are exact data and long, and an update is a chat-style
        // post, so they travel as an attachment. Last, so the screenshots
        // lead the attachment strip.
        const logs = technicalLogsFile(details);
        if (logs) files.push({ name: logs.filename, contentType: logs.contentType, bytes: logs.bytes });
        for (const f of files) {
          try {
            await mondayUpload(tok, attach, f);
          } catch (err) {
            console.warn(`[monday-tracker] upload of ${f.name} failed:`, errorMessage(err));
          }
        }
      }

      // The comment is a reply under the description. monday lists updates
      // newest first, so a second top-level update would sit ABOVE the
      // description and push it down the item.
      if (comment?.trim()) {
        const body = mondayHtml(comment.trim());
        try {
          await mondayGraphQL(tok, CREATE_REPLY, { item: itemId, parent: updateId, body });
        } catch (err) {
          // Only when monday refused the reply itself is a top-level post
          // safe; after a timeout the reply may already be there.
          if (isRequestRejection(err)) {
            try {
              await mondayGraphQL(tok, CREATE_UPDATE, { item: itemId, body });
            } catch (again) {
              console.warn("[monday-tracker] comment post failed:", errorMessage(again));
            }
          } else {
            console.warn("[monday-tracker] comment post failed:", errorMessage(err));
          }
        }
      }

      return {
        id: itemId,
        identifier: itemId,
        url: await itemUrl(targetId, itemId, created.url),
        title,
      };
    },

    async updateIssue(identifier, patch: IssuePatch): Promise<UpdateResult> {
      const id = parseItemId(identifier);
      if (!id) return { ok: false, error: `"${identifier}" is not a Monday item id (expected digits, e.g. 1234567890)` };
      try {
        const found = await mondayGraphQL<{ items?: Array<{ board?: { id: string } | null }> | null }>(
          tok,
          ITEM_BOARD_QUERY,
          { ids: [id] },
        );
        const boardId = found.items?.[0]?.board?.id;
        if (!boardId) return { ok: false, error: `Monday item ${id} not found.` };
        const board = await loadBoard(String(boardId));
        if (!board) return { ok: false, error: `The board of Monday item ${id} could not be read.` };

        const built = await buildColumnValues(board, {
          state: patch.state,
          priority: patch.priority,
          assignee: patch.assignee,
          extraFields: patch.extraFields,
        });
        const errors = [...built.errors];
        let group: { id: string; title: string } | undefined;
        if (patch.project?.trim()) {
          group = findGroup(board, patch.project);
          if (!group) {
            errors.push(`Unknown group "${patch.project}". Valid: ${board.groups.map((g) => g.title).join(", ")}`);
          }
        }
        // Report every bad value before changing anything, so a half-applied
        // update never leaves the agent guessing which part landed.
        if (errors.length) return { ok: false, error: errors.join(" ") };

        const values = { ...built.values };
        if (patch.title?.trim()) values.name = patch.title.trim();
        if (!Object.keys(values).length && !group) return { ok: false, error: "nothing to update" };

        if (Object.keys(values).length) {
          await mondayGraphQL(tok, CHANGE_VALUES, { item: id, board: board.id, cols: JSON.stringify(values) });
        }
        if (group) await mondayGraphQL(tok, MOVE_TO_GROUP, { item: id, group: group.id });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async getIssue(identifier) {
      const id = parseItemId(identifier);
      if (!id) throw new Error(`"${identifier}" is not a Monday item id (expected digits, e.g. 1234567890)`);
      const d = await mondayGraphQL<{ items?: ItemRaw[] | null }>(tok, ITEM_QUERY, { ids: [id] });
      const item = d.items?.[0];
      if (!item) throw new Error(`Monday item ${id} not found.`);
      const cols = itemColumns(item.column_values);
      const status = statusColumn(cols);
      const prio = priorityColumn(cols);
      const people = peopleColumn(cols);

      const out: Record<string, unknown> = {
        identifier: String(item.id),
        title: item.name,
        url: await itemUrl(item.board?.id, String(item.id), item.url),
        board: item.board?.name ?? null,
        group: item.group?.title ?? null,
        state: status?.text || null,
        priority: prio?.text || null,
        assignee: people?.text || null,
        itemState: item.state ?? null,
      };
      // Every other column the item has a value in, by its title, so the
      // agent can verify a custom field it set the same way it set it.
      for (const c of cols) {
        if (c === status || c === prio || c === people || !c.text) continue;
        if (!(c.title in out)) out[c.title] = c.text;
      }
      return out;
    },

    async getLiveIssues(identifiers): Promise<LiveIssueLookup> {
      const issues: Record<string, LiveIssue> = {};
      const gone: string[] = [];
      const ids = Array.from(
        new Set(identifiers.map((i) => parseItemId(i)).filter((i): i is string => !!i)),
      );
      const items: ItemRaw[] = [];

      // A failed read says nothing about whether these items exist, so it
      // leaves `gone` alone and the rows keep their snapshots. When monday
      // refused the request itself, one bad id may be the cause, and it
      // should not stale the other 99: ask again in tens, then one by one.
      // An outage or a throttle is not split, since that would only multiply
      // the failing calls.
      const read = async (batch: string[]): Promise<void> => {
        try {
          const d = await mondayGraphQL<{ items?: ItemRaw[] | null }>(tok, LIVE_QUERY, { ids: batch });
          items.push(...(d.items ?? []));
        } catch (err) {
          if (batch.length === 1 || !isRequestRejection(err)) return;
          for (const part of chunk(batch, batch.length > 10 ? 10 : 1)) await read(part);
        }
      };
      for (const batch of chunk(ids, 100)) await read(batch);

      for (const item of items) {
        const id = String(item.id);
        // monday keeps a deleted item readable (in its trash) and says so.
        // An id it simply leaves out of the answer is NOT that: it may be
        // on a board this token can no longer see.
        if (item.state === "deleted") {
          gone.push(id);
          continue;
        }
        const cols = itemColumns(item.column_values);
        const archived = item.state === "archived";
        const statusText = statusColumn(cols)?.text;
        const stateName = archived ? "Archived" : statusText || "Open";
        const person = peopleColumn(cols)?.text;
        const name = person ? firstPerson(person) : undefined;
        issues[id] = {
          identifier: id,
          title: item.name,
          url: await itemUrl(item.board?.id, id, item.url),
          stateName,
          stateColor: archived ? STATUS_COLOR.done : mondayStateColor(stateName),
          createdAt: item.created_at ?? "",
          assignee: name ? { name } : undefined,
        };
      }
      return { issues, gone };
    },
  };
}
