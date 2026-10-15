import {
  NO_CAPABILITIES,
  STATUS_COLOR,
  matchPriorityLabel,
  resolveName,
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
import { batchBlocks, parseRichText, plainRichText } from "./notion-blocks";
import { buildNotionBody } from "./notion-body";

export type NotionTok = { token: string };

const API = "https://api.notion.com/v1";
// The last version before databases split into data sources (2025-09-03). A
// database with ONE data source, which is nearly all of them, still answers to
// its database id here, so the adapter keeps one id per target.
const NOTION_VERSION = "2022-06-28";

const AUTH_EXPIRED =
  "Your Notion connection has expired - reconnect Notion under Settings, then retry.";

// ---------------------------------------------------------------------------
// Property mapping
// ---------------------------------------------------------------------------

export type NotionProperty = {
  id: string;
  name: string;
  type: string;
  select?: { options?: Array<{ name: string }> };
  multi_select?: { options?: Array<{ name: string }> };
  status?: { options?: Array<{ name: string }> };
};

/**
 * A Notion database has no fixed schema: whoever made it chose the property
 * names and types. So rather than guess, the well-known roles are found by
 * looking for the property TYPE first and falling back to conventional names -
 * and everything else is surfaced through the generic custom-fields mechanism
 * the agent already drives for Jira.
 */
export function findRole(
  properties: Record<string, NotionProperty>,
  role: "title" | "status" | "priority" | "labels" | "assignee",
): NotionProperty | undefined {
  const all = Object.values(properties);
  const byName = (re: RegExp, types: string[]) =>
    all.find((p) => types.includes(p.type) && re.test(p.name.toLowerCase()));

  switch (role) {
    case "title":
      return all.find((p) => p.type === "title");
    case "status":
      // A real `status` property is unambiguous; otherwise a select named
      // Status/State/Stage is the near-universal convention.
      return all.find((p) => p.type === "status") ?? byName(/^(status|state|stage)$/, ["select"]);
    case "priority":
      return byName(/^(priority|urgency|severity)$/, ["select", "status"]);
    case "labels":
      return (
        byName(/^(tags?|labels?|categor(y|ies)|topics?)$/, ["multi_select"]) ??
        all.find((p) => p.type === "multi_select")
      );
    case "assignee":
      return (
        byName(/^(assignee|owner|assigned to|responsible)$/, ["people"]) ??
        all.find((p) => p.type === "people")
      );
  }
}

export function optionsOf(p?: NotionProperty): string[] {
  if (!p) return [];
  return (p.select?.options ?? p.multi_select?.options ?? p.status?.options ?? [])
    .map((o) => o.name)
    .filter(Boolean);
}

/**
 * The priority option that means `want`, or undefined when none does.
 *
 * Teams name priorities their own way ("P1", "High", "Critical"), so an exact
 * name comes first, then the shared priority conventions (the matcher GitHub
 * uses for its labels), and only then a loose prefix/substring match. The
 * order matters: a loose match of "urgent" finds "Not urgent". Negated
 * options are never candidates for the same reason, and no match means the
 * priority is left unset rather than set to something that means otherwise.
 */
export function priorityOption(p: NotionProperty | undefined, want: TrackerPriority): string | undefined {
  const options = optionsOf(p).filter((o) => !/\b(not|non|no)\b/i.test(o));
  const w = want.trim().toLowerCase();
  return (
    options.find((o) => o.trim().toLowerCase() === w) ??
    matchPriorityLabel(want, options) ??
    resolveName(want, options)
  );
}

/**
 * Build the value object for one property. Notion's write format differs per
 * type, and sending the wrong shape rejects the whole page create, so anything
 * we can't map confidently returns undefined and is simply left unset.
 */
export function propertyValue(
  p: NotionProperty,
  want: unknown,
  people: Array<{ id: string; name: string }> = [],
): Record<string, unknown> | undefined {
  const str = (v: unknown) => (v == null ? "" : String(v));
  switch (p.type) {
    case "title":
      // A title is plain text everywhere Notion shows it (lists, links,
      // search), so markdown in it would read as literal asterisks or, worse,
      // a link nobody can see. It is written exactly as given.
      return { title: plainRichText(str(want)) };
    case "rich_text":
      return { rich_text: parseRichText(str(want)) };
    case "select": {
      const canonical = resolveName(str(want), optionsOf(p));
      return canonical ? { select: { name: canonical } } : undefined;
    }
    case "status": {
      const canonical = resolveName(str(want), optionsOf(p));
      return canonical ? { status: { name: canonical } } : undefined;
    }
    case "multi_select": {
      const wants = Array.isArray(want) ? want.map(str) : [str(want)];
      const options = optionsOf(p);
      // Only options the property already has, as with GitHub labels: Notion
      // would otherwise quietly add a new option for every typo. A property
      // with no options yet has nothing to choose from, so there the names
      // are taken as given and the first ticket seeds it.
      const names = wants
        .map((w) => (options.length ? resolveName(w, options) : w.trim()))
        .filter((n): n is string => !!n);
      const unique = Array.from(new Set(names));
      return unique.length ? { multi_select: unique.map((name) => ({ name })) } : undefined;
    }
    case "people": {
      const wants = Array.isArray(want) ? want.map(str) : [str(want)];
      const ids = wants
        .map((w) => {
          const canonical = resolveName(
            w,
            people.map((u) => u.name),
          );
          return people.find((u) => u.name === canonical)?.id;
        })
        .filter((x): x is string => !!x);
      return ids.length ? { people: ids.map((id) => ({ id })) } : undefined;
    }
    case "number": {
      const n = Number(want);
      return Number.isFinite(n) ? { number: n } : undefined;
    }
    case "checkbox":
      return { checkbox: want === true || want === "true" };
    case "url":
      return { url: str(want) || null };
    case "email":
      return { email: str(want) || null };
    case "phone_number":
      return { phone_number: str(want) || null };
    case "date":
      return { date: str(want) ? { start: str(want) } : null };
    default:
      // Formula, rollup, created_time and friends are computed by Notion and
      // cannot be written at all.
      return undefined;
  }
}

/** One property value as Notion returns it - shape varies entirely by type. */
type RawProperty = {
  type?: string;
  [key: string]: unknown;
};
type RawText = { plain_text?: string; text?: { content?: string } };
type RawNamed = { name?: string; id?: string };

/** Read one property back as a plain value, for the agent's verify step. */
export function readProperty(value: unknown): unknown {
  const v = value as RawProperty | null;
  if (!v || typeof v !== "object") return null;
  switch (v.type) {
    case "title":
    case "rich_text":
      return ((v[v.type] as RawText[]) ?? [])
        .map((t) => t.plain_text ?? t.text?.content ?? "")
        .join("");
    case "select":
      return (v.select as RawNamed | null)?.name ?? null;
    case "status":
      return (v.status as RawNamed | null)?.name ?? null;
    case "multi_select":
      return ((v.multi_select as RawNamed[]) ?? []).map((o) => o.name);
    case "people":
      return ((v.people as RawNamed[]) ?? []).map((p) => p.name ?? p.id);
    case "number":
      return v.number ?? null;
    case "checkbox":
      return !!v.checkbox;
    case "url":
    case "email":
    case "phone_number":
      return v[v.type] ?? null;
    case "date":
      return (v.date as { start?: string } | null)?.start ?? null;
    default:
      return null;
  }
}

/** Colour a Notion status/select option by what it usually means. */
export function notionStatusColor(name?: string): string {
  const n = (name ?? "").toLowerCase();
  if (/\b(done|complete|completed|closed|shipped|resolved|archived)\b/.test(n)) {
    return STATUS_COLOR.done;
  }
  if (/\b(progress|doing|active|review|testing|current)\b/.test(n)) return STATUS_COLOR.active;
  return STATUS_COLOR.neutral;
}

/** Notion page ids are UUIDs; its urls use the dashless form. */
export function pageUrl(id: string, title?: string): string {
  const bare = (id ?? "").replace(/-/g, "");
  const slug = (title ?? "")
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return slug ? `https://www.notion.so/${slug}-${bare}` : `https://www.notion.so/${bare}`;
}

/** Notion accepts an id with or without dashes; compare them the same way. */
function sameId(a: string, b: string): boolean {
  const bare = (s: string) => (s ?? "").replace(/-/g, "").toLowerCase();
  return bare(a) === bare(b);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function nt(tok: NotionTok, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${tok.token}`);
  headers.set("Notion-Version", NOTION_VERSION);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const r = await fetch(`${API}${path}`, { ...init, headers });
  if (r.status === 401) throw new Error(AUTH_EXPIRED);
  return r;
}

async function ntJson<T>(tok: NotionTok, path: string, init: RequestInit = {}): Promise<T> {
  const r = await nt(tok, path, init);
  if (!r.ok) throw new Error(`Notion ${path} failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

/** The longest a live read waits on a 429 before giving up on that page for now. */
const MAX_RETRY_WAIT_MS = 3000;

/** Notion's Retry-After is in seconds; a missing or odd value waits one. */
export function retryAfterMs(header: string | null): number {
  const s = Number(header);
  const ms = header != null && header.trim() !== "" && Number.isFinite(s) && s >= 0 ? s * 1000 : 1000;
  return Math.min(ms, MAX_RETRY_WAIT_MS);
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

/**
 * The workspace this token belongs to, for the org identity.
 *
 * A Notion token is minted for exactly one workspace, the one the integration
 * was installed in, so there is never a choice to make. The bot user carries
 * its id. The id is the only acceptable key: it becomes the org key that
 * shares ticket rules and a leaderboard, and a workspace NAME is neither
 * unique nor stable ("Acme" is many companies), so without an id there is no
 * workspace at all. Best-effort: [] on any failure.
 */
export async function listNotionWorkspaces(tok: NotionTok): Promise<Workspace[]> {
  try {
    const r = await nt(tok, "/users/me");
    if (!r.ok) return [];
    const me = (await r.json()) as {
      bot?: { workspace_id?: string | null; workspace_name?: string | null };
    };
    const id = me.bot?.workspace_id;
    if (!id) return [];
    return [{ id, name: me.bot?.workspace_name || "Notion workspace" }];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tracker implementation
// ---------------------------------------------------------------------------

type NotionDb = {
  id: string;
  title?: Array<{ plain_text?: string }>;
  description?: Array<{ plain_text?: string }>;
  properties?: Record<string, NotionProperty>;
};

type NotionPage = {
  id: string;
  url?: string;
  created_time?: string;
  archived?: boolean;
  in_trash?: boolean;
  properties?: Record<string, unknown>;
  parent?: { database_id?: string };
};

function plain(rich?: Array<{ plain_text?: string }>): string {
  return (rich ?? []).map((t) => t.plain_text ?? "").join("");
}

/** Pages of 100 databases to list at most; past that the picker is unusable anyway. */
const MAX_DATABASE_PAGES = 10;
/** Pages of 100 workspace members to read at most, for assignee resolution. */
const MAX_USER_PAGES = 5;

export function makeNotionTracker(tok: NotionTok): Tracker {
  let dbCache: TrackerTarget[] | null = null;
  const dbMeta = new Map<string, NotionDb>();
  // One request per database even when several live reads need its schema at
  // the same moment; the workers below would otherwise each fetch it.
  const dbInFlight = new Map<string, Promise<NotionDb>>();
  let peopleCache: Array<{ id: string; name: string }> | null = null;

  async function loadDatabases(): Promise<TrackerTarget[]> {
    if (dbCache) return dbCache;
    const out: TrackerTarget[] = [];
    let cursor: string | undefined;
    let page = 0;
    do {
      const j = await ntJson<{
        results?: NotionDb[];
        next_cursor?: string | null;
        has_more?: boolean;
      }>(tok, `/search`, {
        method: "POST",
        body: JSON.stringify({
          filter: { property: "object", value: "database" },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      });
      for (const db of j.results ?? []) {
        dbMeta.set(db.id, db);
        out.push({
          id: db.id,
          key: plain(db.title) || db.id,
          name: plain(db.title) || "Untitled database",
          description: plain(db.description) || undefined,
        });
      }
      cursor = j.has_more ? (j.next_cursor ?? undefined) : undefined;
      page += 1;
    } while (cursor && page < MAX_DATABASE_PAGES);
    dbCache = out;
    return out;
  }

  async function database(id: string): Promise<NotionDb> {
    const cached = dbMeta.get(id);
    if (cached?.properties) return cached;
    let pending = dbInFlight.get(id);
    if (!pending) {
      pending = ntJson<NotionDb>(tok, `/databases/${id}`)
        .then((db) => {
          dbMeta.set(id, db);
          return db;
        })
        // A failure is not cached: the next caller asks again.
        .finally(() => dbInFlight.delete(id));
      dbInFlight.set(id, pending);
    }
    return pending;
  }

  async function loadPeople(): Promise<Array<{ id: string; name: string }>> {
    if (peopleCache) return peopleCache;
    const out: Array<{ id: string; name: string }> = [];
    try {
      // Needs the integration's "read user information" capability; without it
      // Notion answers 403 and assignment is simply unavailable.
      let cursor: string | undefined;
      let page = 0;
      do {
        const j = await ntJson<{
          results?: Array<{ id: string; name?: string; type?: string }>;
          next_cursor?: string | null;
          has_more?: boolean;
        }>(tok, `/users?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`);
        for (const u of j.results ?? []) {
          if (u.type !== "bot" && u.name) out.push({ id: u.id, name: u.name });
        }
        cursor = j.has_more ? (j.next_cursor ?? undefined) : undefined;
        page += 1;
      } while (cursor && page < MAX_USER_PAGES);
    } catch {
      /* keep whoever was read before the failure */
    }
    peopleCache = out;
    return out;
  }

  function titleOf(page: NotionPage, db?: NotionDb): string {
    const props = page.properties ?? {};
    const titleProp = db?.properties ? findRole(db.properties, "title") : undefined;
    const value = titleProp ? props[titleProp.name] : Object.values(props).find(
      (p) => (p as { type?: string })?.type === "title",
    );
    return String(readProperty(value) ?? "");
  }

  function statusOf(page: NotionPage, db?: NotionDb): string {
    if (!db?.properties) return "";
    const statusProp = findRole(db.properties, "status");
    if (!statusProp) return "";
    return String(readProperty((page.properties ?? {})[statusProp.name]) ?? "");
  }

  return {
    kind: "notion",
    targetNoun: "database",
    capabilities: {
      ...NO_CAPABILITIES,
      states: true,
      priority: true,
      labels: true,
      // Every non-title database property is offered through custom fields,
      // which is what makes an arbitrary user-defined schema fillable.
      customFields: true,
      comments: true,
    },
    bodyGuidance:
      "The description becomes the page's body blocks: headings, lists, quotes and code blocks are rendered natively, and section labels you write on their own line become real headings. The database's own properties are the fields: status, priority and tags are whatever properties this database defines, so use the exact names and options from its details.",

    async listTargets() {
      return loadDatabases();
    },

    async searchIssues(query, opts): Promise<IssueSearchResult[]> {
      const q = query.trim();
      if (!q) return [];
      try {
        const limit = Math.min(Math.max(opts?.limit ?? 15, 1), 50);
        const j = await ntJson<{ results?: NotionPage[] }>(tok, `/search`, {
          method: "POST",
          body: JSON.stringify({
            query: q,
            filter: { property: "object", value: "page" },
            page_size: limit,
          }),
        });
        // Only pages that live in a database are tickets; a loose page is a doc.
        const pages = (j.results ?? []).filter((p) => p.parent?.database_id);
        const out: IssueSearchResult[] = [];
        for (const p of pages) {
          const dbId = p.parent!.database_id!;
          const db = await database(dbId).catch(() => undefined);
          const labelsProp = db?.properties ? findRole(db.properties, "labels") : undefined;
          const priorityProp = db?.properties ? findRole(db.properties, "priority") : undefined;
          const assigneeProp = db?.properties ? findRole(db.properties, "assignee") : undefined;
          const props = p.properties ?? {};
          const labels = labelsProp ? readProperty(props[labelsProp.name]) : [];
          const people = assigneeProp ? readProperty(props[assigneeProp.name]) : [];
          out.push({
            identifier: p.id,
            title: titleOf(p, db),
            url: p.url ?? pageUrl(p.id),
            target: db ? plain(db.title) : "",
            state: statusOf(p, db) || undefined,
            labels: Array.isArray(labels) ? (labels as string[]) : [],
            assignee: Array.isArray(people) ? (people as string[])[0] : undefined,
            priority: priorityProp
              ? (String(readProperty(props[priorityProp.name]) ?? "") || undefined)
              : undefined,
          });
        }
        return out;
      } catch {
        return [];
      }
    },

    async getTargetDetails(targetId): Promise<TargetDetails> {
      const dbs = await loadDatabases();
      const target = dbs.find((d) => sameId(d.id, targetId));
      if (!target) {
        throw new Error(
          `Notion: database ${targetId} not found. Known databases: ${dbs.map((d) => `${d.name} (id: ${d.id})`).join(", ")}`,
        );
      }
      const [db, people] = await Promise.all([database(target.id), loadPeople()]);
      const props = db.properties ?? {};

      const statusProp = findRole(props, "status");
      const labelsProp = findRole(props, "labels");
      const priorityProp = findRole(props, "priority");
      const assigneeProp = findRole(props, "assignee");
      const titleProp = findRole(props, "title");

      // Roles already reachable through a first-class parameter are not
      // repeated as custom fields; everything else the agent can actually write
      // is, with its real name and allowed values.
      const claimed = new Set(
        [statusProp, labelsProp, priorityProp, assigneeProp, titleProp]
          .filter(Boolean)
          .map((p) => p!.name),
      );
      const writable = new Set([
        "rich_text", "select", "status", "multi_select", "people", "number",
        "checkbox", "url", "email", "phone_number", "date",
      ]);
      const customFields = Object.values(props)
        .filter((p) => !claimed.has(p.name) && writable.has(p.type))
        .map((p) => ({
          id: p.name,
          name: p.name,
          type: p.type,
          allowedValues: optionsOf(p).length ? optionsOf(p) : undefined,
        }));

      return {
        id: target.id,
        key: target.key,
        name: target.name,
        description: target.description,
        states: optionsOf(statusProp),
        labels: optionsOf(labelsProp),
        members: people.map((p) => p.name),
        customFields,
      };
    },

    async fileIssue({
      targetId,
      title,
      descriptionMarkdown,
      labels,
      priority,
      state,
      assignee,
      comment,
      extraFields,
      evidence,
      details,
    }) {
      const [db, people] = await Promise.all([database(targetId), loadPeople()]);
      const props = db.properties ?? {};
      const titleProp = findRole(props, "title");
      if (!titleProp) {
        throw new Error(`Notion: database ${targetId} has no title property to file into.`);
      }

      const blocks = buildNotionBody(descriptionMarkdown, evidence, details);

      // The first-class fields are resolved against the database's own
      // options before they are sent; extraFields are the agent's free-form
      // values. Kept apart so a rejection can drop only the latter.
      const core: Record<string, unknown> = {
        [titleProp.name]: propertyValue(titleProp, title, people)!,
      };
      const extra: Record<string, unknown> = {};
      const set = (into: Record<string, unknown>, p: NotionProperty | undefined, want: unknown) => {
        if (!p || want == null || want === "") return;
        const v = propertyValue(p, want, people);
        if (v) into[p.name] = v;
        else console.warn(`[notion-tracker] could not set ${p.name} (${p.type}) to ${String(want)}`);
      };
      if (state) set(core, findRole(props, "status"), state);
      if (priority) {
        const p = findRole(props, "priority");
        set(core, p, priorityOption(p, priority));
      }
      if (labels?.length) set(core, findRole(props, "labels"), labels);
      if (assignee) set(core, findRole(props, "assignee"), assignee);
      for (const [k, v] of Object.entries(extraFields ?? {})) {
        // A key that is not a property of this database has nowhere to go.
        const prop = props[k] ?? Object.values(props).find((p) => p.name.toLowerCase() === k.toLowerCase());
        set(extra, prop, v);
      }
      // Resolved fields win over a free-form value for the same property.
      const properties = { ...extra, ...core };

      // Notion caps a request at 100 top-level children, so the body's first
      // batch goes with the page and the rest is appended in order.
      const batches = batchBlocks(blocks);
      const create = (fields: Record<string, unknown>) =>
        nt(tok, `/pages`, {
          method: "POST",
          body: JSON.stringify({
            parent: { database_id: targetId },
            properties: fields,
            ...(batches.length ? { children: batches[0] } : {}),
          }),
        });

      let r = await create(properties);
      if (r.status === 400) {
        const why = await r.text();
        const droppable = Object.keys(extra).filter((k) => !(k in core));
        // Only a rejected property is worth a second try, and only the
        // free-form ones are dropped: a date the agent wrote as "yesterday"
        // must not lose the ticket, and the agent's verify step repairs it
        // through updateIssue, which reports what is wrong. A rejected body
        // would fail the same way twice, so it fails now.
        if (!/body\.properties/.test(why) || !droppable.length) {
          throw new Error(`Notion /pages failed: 400 ${why}`);
        }
        console.warn(
          `[notion-tracker] filing without ${droppable.join(", ")}, which Notion rejected: ${why}`,
        );
        r = await create(core);
      }
      if (!r.ok) throw new Error(`Notion /pages failed: ${r.status} ${await r.text()}`);
      const page = (await r.json()) as NotionPage;

      for (const batch of batches.slice(1)) {
        try {
          await ntJson(tok, `/blocks/${page.id}/children`, {
            method: "PATCH",
            body: JSON.stringify({ children: batch }),
          });
        } catch (err) {
          console.warn("[notion-tracker] appending body blocks failed:", err);
        }
      }

      if (comment?.trim()) {
        try {
          await ntJson(tok, `/comments`, {
            method: "POST",
            body: JSON.stringify({
              parent: { page_id: page.id },
              rich_text: parseRichText(comment.trim()),
            }),
          });
        } catch (err) {
          console.warn("[notion-tracker] comment post failed:", err);
        }
      }

      return {
        id: page.id,
        identifier: page.id,
        url: page.url ?? pageUrl(page.id, title),
        title,
      };
    },

    async updateIssue(identifier, patch: IssuePatch): Promise<UpdateResult> {
      try {
        const page = await ntJson<NotionPage>(tok, `/pages/${identifier}`);
        const dbId = page.parent?.database_id;
        if (!dbId) return { ok: false, error: `page ${identifier} is not in a database` };
        const [db, people] = await Promise.all([database(dbId), loadPeople()]);
        const props = db.properties ?? {};

        const properties: Record<string, unknown> = {};
        const apply = (
          p: NotionProperty | undefined,
          want: unknown,
          role: string,
        ): string | null => {
          if (!p) return `this database has no ${role} property`;
          const v = propertyValue(p, want, people);
          if (!v) {
            const opts = optionsOf(p);
            return `"${String(want)}" is not valid for ${p.name}${opts.length ? `. Allowed values: ${opts.join(", ")}` : ""}`;
          }
          properties[p.name] = v;
          return null;
        };

        if (patch.title) {
          const err = apply(findRole(props, "title"), patch.title, "title");
          if (err) return { ok: false, error: err };
        }
        if (patch.state) {
          const err = apply(findRole(props, "status"), patch.state, "status");
          if (err) return { ok: false, error: err };
        }
        if (patch.priority) {
          const p = findRole(props, "priority");
          if (!p) return { ok: false, error: "this database has no priority property" };
          const pick = priorityOption(p, patch.priority);
          if (!pick) {
            const opts = optionsOf(p);
            return {
              ok: false,
              error: opts.length
                ? `no option of ${p.name} means "${patch.priority}". Allowed values: ${opts.join(", ")}`
                : `${p.name} has no options to choose from`,
            };
          }
          const err = apply(p, pick, "priority");
          if (err) return { ok: false, error: err };
        }
        if (patch.labels?.length) {
          const p = findRole(props, "labels");
          // propertyValue drops unknown tags quietly, which is right on create
          // but would hide the mistake here; name them so the agent can fix it.
          const opts = optionsOf(p);
          const missing = opts.length ? patch.labels.filter((l) => !resolveName(l, opts)) : [];
          if (p && missing.length) {
            return {
              ok: false,
              error: `${p.name} has no option ${missing.map((m) => `"${m}"`).join(", ")}. Allowed values: ${opts.join(", ")}`,
            };
          }
          const err = apply(p, patch.labels, "tags");
          if (err) return { ok: false, error: err };
        }
        if (patch.assignee) {
          const err = apply(findRole(props, "assignee"), patch.assignee, "assignee");
          if (err) return { ok: false, error: err };
        }
        for (const [k, v] of Object.entries(patch.extraFields ?? {})) {
          const prop =
            props[k] ?? Object.values(props).find((p) => p.name.toLowerCase() === k.toLowerCase());
          if (!prop) {
            return {
              ok: false,
              error: `property "${k}" not found. Valid properties: ${Object.keys(props).join(", ")}`,
            };
          }
          const err = apply(prop, v, k);
          if (err) return { ok: false, error: err };
        }

        if (!Object.keys(properties).length) return { ok: false, error: "nothing to update" };
        const r = await nt(tok, `/pages/${identifier}`, {
          method: "PATCH",
          body: JSON.stringify({ properties }),
        });
        if (!r.ok) return { ok: false, error: `Notion update failed: ${r.status} ${await r.text()}` };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    async getIssue(identifier) {
      const page = await ntJson<NotionPage>(tok, `/pages/${identifier}`);
      const dbId = page.parent?.database_id;
      const db = dbId ? await database(dbId).catch(() => undefined) : undefined;
      const props = page.properties ?? {};
      const title = titleOf(page, db);
      const state = statusOf(page, db);
      const labelsProp = db?.properties ? findRole(db.properties, "labels") : undefined;
      const priorityProp = db?.properties ? findRole(db.properties, "priority") : undefined;
      const assigneeProp = db?.properties ? findRole(db.properties, "assignee") : undefined;
      const assignees = assigneeProp ? readProperty(props[assigneeProp.name]) : [];

      return {
        identifier: page.id,
        title,
        url: page.url ?? pageUrl(page.id, title),
        state: state || null,
        stateColor: notionStatusColor(state),
        assignee: Array.isArray(assignees) ? ((assignees as string[])[0] ?? null) : null,
        labels: labelsProp ? (readProperty(props[labelsProp.name]) as string[]) : [],
        priority: priorityProp ? (readProperty(props[priorityProp.name]) as string | null) : null,
        // Every remaining property, so the agent can verify custom fields too.
        customFields: Object.fromEntries(
          Object.entries(props).map(([name, value]) => [name, readProperty(value)]),
        ),
      };
    },

    async getLiveIssues(identifiers): Promise<LiveIssueLookup> {
      const issues: Record<string, LiveIssue> = {};
      const gone: string[] = [];
      const ids = Array.from(new Set(identifiers.filter(Boolean)));
      if (!ids.length) return { issues, gone };

      // A rate-limited read is retried once, after the wait Notion asks for
      // (capped so one slow page cannot stall the dashboard); a second 429
      // leaves that ticket unknown until the next sync.
      const read = async (id: string): Promise<Response> => {
        const r = await nt(tok, `/pages/${id}`);
        if (r.status !== 429) return r;
        await new Promise((done) => setTimeout(done, retryAfterMs(r.headers.get("Retry-After"))));
        return nt(tok, `/pages/${id}`);
      };

      // Notion has no batch page read, so these are individual gets. Three at
      // a time keeps the burst small; Notion's limit is an AVERAGE of three
      // requests per second, which concurrency alone does not guarantee, so
      // the 429 retry above is what actually honours it.
      const queue = [...ids];
      const worker = async () => {
        for (;;) {
          const id = queue.shift();
          if (!id) return;
          try {
            const r = await read(id);
            // A 404 is NOT a deletion. Notion answers object_not_found both for
            // a page that is gone and for one the integration can no longer
            // see, which is what reconnecting with a narrower page picker
            // does; reading that as "deleted" would mark every ticket in the
            // feed Deleted. Unknown is the honest answer.
            if (!r.ok) continue;
            const page = (await r.json()) as NotionPage;
            // A page in the trash still resolves, and says so: that IS Notion
            // confirming the ticket was deleted.
            if (page.in_trash || page.archived) {
              gone.push(id);
              continue;
            }
            const dbId = page.parent?.database_id;
            const db = dbId ? await database(dbId).catch(() => undefined) : undefined;
            const title = titleOf(page, db);
            const state = statusOf(page, db);
            const assigneeProp = db?.properties ? findRole(db.properties, "assignee") : undefined;
            const who = assigneeProp
              ? readProperty((page.properties ?? {})[assigneeProp.name])
              : [];
            issues[id] = {
              identifier: page.id,
              title,
              url: page.url ?? pageUrl(page.id, title),
              stateName: state,
              stateColor: notionStatusColor(state),
              createdAt: page.created_time ?? "",
              assignee:
                Array.isArray(who) && who.length ? { name: String(who[0]) } : undefined,
            };
          } catch {
            continue;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker));
      return { issues, gone };
    },
  };
}
