import {
  NO_CAPABILITIES,
  STATUS_COLOR,
  resolveName,
  withBriefAttribution,
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
import { evidenceFileName, evidenceKind, joinBlocks, placeEvidence, promoteSectionHeadings } from "./ticket-body";

/**
 * A ClickUp connection. `teamId` is the workspace the user picked (ClickUp's
 * v2 API calls a workspace a "team"). When it is set, everything Brief lists,
 * searches and files stays inside that one workspace, because the pick is
 * also the org identity and a ticket must not land in some other company's
 * workspace the same person happens to belong to.
 */
export type ClickUpTok = { token: string; teamId?: string };

const API = "https://api.clickup.com/api/v2";

const AUTH_EXPIRED =
  "Your ClickUp connection has expired - reconnect ClickUp under Settings, then retry.";

/**
 * ClickUp's "Team not authorized" codes. They come back as a 401 like a dead
 * token does, but they mean something else: the token is fine and the item
 * either does not exist or lives in a workspace the user never granted Brief.
 * A mistyped task id answers this way too, so reading it as "reconnect" would
 * send the user after the wrong problem.
 */
const TEAM_NOT_AUTHORIZED = /^OAUTH_0(23|26|27|29|3\d|4[0-5])$/;

/**
 * The same refusal on a workspace-level path is unambiguous: the workspace the
 * user picked has dropped out of the grant (ClickUp's consent screen lets them
 * untick it), so the fix is to reconnect and tick it again.
 */
const WORKSPACE_NOT_GRANTED =
  "Your ClickUp connection no longer covers the workspace picked on Settings - reconnect ClickUp and tick that workspace, then retry.";

/** ClickUp priority is 1 (urgent) to 4 (low). */
const CU_PRIORITY: Record<TrackerPriority, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

/** ClickUp's own priority names. Its "normal" is our "medium". */
const CU_PRIORITY_NAME: Record<string, TrackerPriority> = {
  urgent: "urgent",
  high: "high",
  normal: "medium",
  low: "low",
};

export function clickupPriorityName(value: unknown): string | null {
  const fromNumber = (raw: unknown) => {
    const n = Number(raw);
    const hit = (Object.entries(CU_PRIORITY) as Array<[TrackerPriority, number]>).find(
      ([, v]) => v === n,
    );
    return hit ? hit[0] : null;
  };
  // A task read returns an object, {id: "2", priority: "high", ...}, where
  // `priority` is the NAME; older payloads put the number there instead.
  if (value && typeof value === "object") {
    const o = value as { id?: unknown; priority?: unknown };
    const byName = CU_PRIORITY_NAME[String(o.priority ?? "").toLowerCase()];
    return byName ?? fromNumber(o.id ?? o.priority);
  }
  return fromNumber(value);
}

/** Map a ClickUp status type to one of our brand status colors. */
export function clickupStatusColor(type?: string): string {
  switch ((type ?? "").toLowerCase()) {
    case "done":
    case "closed":
      return STATUS_COLOR.done;
    case "custom":
      return STATUS_COLOR.active;
    default:
      return STATUS_COLOR.neutral;
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * ClickUp's authentication docs give two header forms: a personal token
 * (always `pk_...`) goes in raw, and an OAuth access token goes after
 * "Bearer". Brief's own OAuth hands us the second kind; the live test uses
 * the first.
 */
export function clickupAuthHeader(token: string): string {
  return token.startsWith("pk_") ? token : `Bearer ${token}`;
}

/** A 401 from ClickUp: the token is dead, or the workspace was never granted. */
class ClickUpAuthError extends Error {}

async function cu(tok: ClickUpTok, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", clickupAuthHeader(tok.token));
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const r = await fetch(`${API}${path}`, { ...init, headers });
  if (r.status === 401) {
    const ecode = await r
      .json()
      .then((j: { ECODE?: unknown }) => String(j?.ECODE ?? ""))
      .catch(() => "");
    if (TEAM_NOT_AUTHORIZED.test(ecode)) {
      if (/^\/team\/[^/?]+\//.test(path)) throw new ClickUpAuthError(WORKSPACE_NOT_GRANTED);
      throw new ClickUpAuthError(
        `ClickUp ${path} refused (${ecode}): the item does not exist, or it is in a workspace Brief was not given access to.`,
      );
    }
    throw new ClickUpAuthError(AUTH_EXPIRED);
  }
  return r;
}

async function cuJson<T>(tok: ClickUpTok, path: string, init: RequestInit = {}): Promise<T> {
  const r = await cu(tok, path, init);
  if (!r.ok) throw new Error(`ClickUp ${path} failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

/**
 * The markdown body, under both names ClickUp uses for it. The Create Task
 * schema calls the field `markdown_content`, while the same page's request
 * example and every task read-back call it `markdown_description`. Sending the
 * identical text under both means whichever one the server honours, the
 * ticket renders as Markdown instead of showing the raw source.
 */
function markdownFields(body: string): Record<string, string> {
  return { markdown_content: body, markdown_description: body };
}

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

type CuOption = { id: string; name?: string; label?: string; orderindex?: number };

type CuField = {
  id: string;
  name: string;
  type: string;
  type_config?: { options?: CuOption[] };
};

/**
 * Turn an agent-supplied value into the shape ClickUp wants for that field.
 * Dropdown and label fields take an option ID, not the option's text, so the
 * name has to be resolved against the field's own options first.
 */
export function clickupFieldValue(field: CuField, want: unknown): unknown | undefined {
  const options = field.type_config?.options ?? [];
  const optionNames = options.map((o) => o.name ?? o.label ?? "");
  if (field.type === "drop_down") {
    const canonical = resolveName(String(want), optionNames);
    const idx = optionNames.indexOf(canonical ?? "");
    return idx >= 0 ? options[idx].id : undefined;
  }
  if (field.type === "labels") {
    const wants = Array.isArray(want) ? want.map(String) : [String(want)];
    const ids = wants
      .map((w) => {
        const canonical = resolveName(w, optionNames);
        const idx = optionNames.indexOf(canonical ?? "");
        return idx >= 0 ? options[idx].id : undefined;
      })
      .filter((x): x is string => !!x);
    return ids.length ? ids : undefined;
  }
  if (field.type === "checkbox") return want === true || want === "true";
  if (field.type === "number" || field.type === "currency") {
    const n = Number(want);
    return Number.isFinite(n) ? n : undefined;
  }
  return want;
}

/**
 * The reverse of clickupFieldValue, for reading a task back. A dropdown comes
 * back as the chosen option's orderindex and a labels field as option ids, so
 * without this the agent's verify step would see `0` where it set
 * "Production", decide the write failed, and retry for nothing.
 */
export function clickupFieldDisplay(field: CuField & { value?: unknown }): unknown {
  const options = field.type_config?.options ?? [];
  const nameOf = (o: CuOption) => o.name ?? o.label ?? o.id;
  if (field.type === "drop_down") {
    const hit = options.find(
      (o) => o.orderindex === Number(field.value) || o.id === field.value,
    );
    return hit ? nameOf(hit) : field.value;
  }
  if (field.type === "labels" && Array.isArray(field.value)) {
    return field.value.map((v) => {
      const hit = options.find((o) => o.id === v);
      return hit ? nameOf(hit) : v;
    });
  }
  return field.value;
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

/** One uploaded evidence file, by the URL ClickUp gave it. */
export type ClickUpEmbed =
  | { kind: "image"; url: string; caption?: string }
  | { kind: "recording"; url: string };

/** ClickUp's error text from a failed response, short enough for the agent to read. */
async function errText(r: Response): Promise<string> {
  const raw = await r.text().catch(() => "");
  try {
    const j = JSON.parse(raw) as { err?: unknown; ECODE?: unknown };
    if (j.err) return `${r.status} ${String(j.err)}${j.ECODE ? ` (${String(j.ECODE)})` : ""}`;
  } catch {
    /* not JSON */
  }
  return `${r.status} ${raw}`.trim();
}

/**
 * A 404 alone is not proof a task is gone: a proxy or a mistyped route answers
 * 404 too ("Route not found"). ClickUp's own "no such task" carries an ITEM_
 * error code or names the task in its message, and only that is read as a
 * deletion.
 */
export function isClickUpTaskMissing(
  status: number,
  body: { err?: unknown; ECODE?: unknown } | null,
): boolean {
  if (status !== 404 || !body) return false;
  if (/^ITEM_/.test(String(body.ECODE ?? ""))) return true;
  return /\btask\b.*\b(not found|deleted)\b/i.test(String(body.err ?? ""));
}

/**
 * The full task description: the agent's report, the evidence, the technical
 * logs, then the attribution, in that order.
 *
 *  - Section labels the agent writes as a bold line become real headings, as
 *    on GitHub: ClickUp renders Markdown verbatim, so a bold line would stay a
 *    bold paragraph with nothing to navigate by.
 *  - The evidence goes at the end of the agent's own Evidence section when it
 *    wrote one, else under a new heading, never under two (placeEvidence).
 *  - Each caption sits directly above its image, so a screenshot reads as
 *    "what it shows", then the picture.
 *  - A recording is only ever "Screen recording". The ticket never exposes a
 *    file name or how the report was captured.
 *  - The technical logs are exact data, one section per video, after the
 *    evidence so they never come between the reader and the report.
 */
export function buildClickUpBody(
  descriptionMarkdown: string,
  embeds: ClickUpEmbed[],
  details?: Array<{ title: string; markdown: string }>,
): string {
  let body = promoteSectionHeadings(descriptionMarkdown ?? "").replace(/\s+$/, "");

  const parts: string[] = [];
  let imgN = 0;
  for (const e of embeds) {
    if (e.kind === "image") {
      imgN += 1;
      const cap = e.caption?.trim() ? `${e.caption.trim()}\n\n` : "";
      parts.push(`${cap}![Screenshot ${imgN}](${e.url})`);
    } else {
      parts.push(`**Screen recording:** [Watch the screen recording](${e.url})`);
    }
  }
  if (parts.length) body = placeEvidence(body, parts.join("\n\n"));

  const sections = (details ?? [])
    .filter((d) => d.markdown.trim())
    .map((d) => `### ${d.title}\n\n${d.markdown.trim()}`);
  if (sections.length) body = joinBlocks(body, ...sections);

  return withBriefAttribution(body);
}

// ---------------------------------------------------------------------------
// Tracker implementation
// ---------------------------------------------------------------------------

type CuStatus = { status: string; type?: string; orderindex?: number };
type CuList = {
  id: string;
  name: string;
  content?: string;
  statuses?: CuStatus[];
  space?: { id: string; name?: string };
  folder?: { id: string; name?: string };
  archived?: boolean;
};
type CuMember = { id: number; username?: string | null; email?: string | null };
type CuTask = {
  id: string;
  name: string;
  url: string;
  date_created?: string;
  status?: { status?: string; type?: string };
  priority?: unknown;
  assignees?: Array<{ id: number; username?: string; email?: string; profilePicture?: string | null }>;
  space?: { id: string };
  tags?: Array<{ name: string }>;
  list?: { id: string; name?: string };
  custom_fields?: Array<CuField & { value?: unknown }>;
};

const JSON_HEADERS = { "Content-Type": "application/json" };

export function makeClickUpTracker(tok: ClickUpTok): Tracker {
  let listsCache: TrackerTarget[] | null = null;
  const listMeta = new Map<string, CuList>();
  let teamIds: string[] | null = null;

  /**
   * The workspaces to look in. The user's pick when there is one, and then
   * there is no `/team` call at all: listing every workspace only to throw the
   * others away is a request that can fail for nothing.
   */
  async function loadTeams(): Promise<string[]> {
    if (teamIds) return teamIds;
    if (tok.teamId) {
      teamIds = [tok.teamId];
      return teamIds;
    }
    const j = await cuJson<{ teams?: Array<{ id: string | number }> }>(tok, `/team`);
    teamIds = (j.teams ?? []).map((t) => String(t.id));
    return teamIds;
  }

  /**
   * ClickUp nests Lists under Folders under Spaces under Teams, and a List can
   * also sit directly in a Space with no Folder. A ticket is filed into a LIST,
   * so the whole tree is walked once and flattened - the target's name carries
   * the Space / Folder path so the agent can route by area.
   *
   * A branch that fails to load is skipped rather than failing the whole walk,
   * but then the result is not cached, so the next call gets another try
   * instead of a target list that is missing a space for the rest of the run.
   * A 401 is the exception (an expired token, or a workspace ClickUp no
   * longer lets Brief into): it is rethrown, because an empty list would hide
   * the one problem the user can actually fix.
   */
  async function loadLists(): Promise<TrackerTarget[]> {
    if (listsCache) return listsCache;
    const out: TrackerTarget[] = [];
    const seen = new Set<string>();
    let complete = true;
    const soft = <T>(fallback: T) => (e: unknown): T => {
      if (e instanceof ClickUpAuthError) throw e;
      complete = false;
      return fallback;
    };

    const addList = (l: CuList, path: string) => {
      if (l.archived || seen.has(l.id)) return;
      seen.add(l.id);
      listMeta.set(l.id, l);
      out.push({
        id: l.id,
        key: l.name,
        name: path,
        description: l.content || undefined,
        states: (l.statuses ?? []).map((s) => s.status),
      });
    };

    for (const teamId of await loadTeams()) {
      const spaces = await cuJson<{ spaces?: Array<{ id: string; name: string }> }>(
        tok,
        `/team/${teamId}/space?archived=false`,
      ).catch(soft({ spaces: [] }));

      for (const space of spaces.spaces ?? []) {
        const [folders, loose] = await Promise.all([
          cuJson<{ folders?: Array<{ id: string; name: string; lists?: CuList[] }> }>(
            tok,
            `/space/${space.id}/folder?archived=false`,
          ).catch(soft({ folders: [] })),
          cuJson<{ lists?: CuList[] }>(tok, `/space/${space.id}/list?archived=false`).catch(
            soft({ lists: [] }),
          ),
        ]);
        for (const f of folders.folders ?? []) {
          for (const l of f.lists ?? []) addList(l, `${space.name} / ${f.name} / ${l.name}`);
        }
        for (const l of loose.lists ?? []) addList(l, `${space.name} / ${l.name}`);
      }
    }
    if (complete) listsCache = out;
    return out;
  }

  async function listDetails(listId: string): Promise<CuList> {
    const cached = listMeta.get(listId);
    if (cached?.statuses && cached.space) return cached;
    const l = await cuJson<CuList>(tok, `/list/${listId}`);
    listMeta.set(listId, l);
    return l;
  }

  async function listFields(listId: string): Promise<CuField[]> {
    try {
      const j = await cuJson<{ fields?: CuField[] }>(tok, `/list/${listId}/field`);
      return j.fields ?? [];
    } catch {
      return [];
    }
  }

  async function listMembers(listId: string): Promise<CuMember[]> {
    try {
      const j = await cuJson<{ members?: CuMember[] }>(tok, `/list/${listId}/member`);
      return j.members ?? [];
    } catch {
      return [];
    }
  }

  /** Space tags, the closest thing ClickUp has to a label set. */
  async function spaceTags(spaceId: string | undefined): Promise<string[]> {
    if (!spaceId) return [];
    try {
      const j = await cuJson<{ tags?: Array<{ name: string }> }>(tok, `/space/${spaceId}/tag`);
      return (j.tags ?? []).map((t) => t.name);
    } catch {
      return [];
    }
  }

  const memberName = (m: CuMember) => m.username || m.email || String(m.id);

  /** By display name first, then by email, since the agent may only know one. */
  function resolveMember(want: string, members: CuMember[]): CuMember | undefined {
    const canonical = resolveName(want, members.map(memberName));
    const byName = members.find((m) => memberName(m) === canonical);
    if (byName) return byName;
    const w = want.trim().toLowerCase();
    return members.find((m) => (m.email ?? "").toLowerCase() === w);
  }

  function unknownList(targetId: string, lists: TrackerTarget[]): Error {
    return new Error(
      `ClickUp: list ${targetId} not found. Known lists: ${lists.map((l) => `${l.name} (id: ${l.id})`).join(", ")}`,
    );
  }

  function resolveField(fields: CuField[], key: string): CuField | undefined {
    return fields.find((f) => f.id === key || f.name.toLowerCase() === key.toLowerCase());
  }

  function mapTask(t: CuTask): IssueSearchResult {
    return {
      identifier: t.id,
      title: t.name,
      url: t.url,
      target: t.list?.name ?? "",
      state: t.status?.status ?? undefined,
      labels: (t.tags ?? []).map((x) => x.name),
      assignee: t.assignees?.[0]?.username,
      priority: clickupPriorityName(t.priority) ?? undefined,
    };
  }

  return {
    kind: "clickup",
    targetNoun: "list",
    capabilities: {
      ...NO_CAPABILITIES,
      states: true,
      priority: true,
      labels: true,
      customFields: true,
      comments: true,
      nativeAttachments: true,
    },
    bodyGuidance:
      "The description is sent as Markdown and ClickUp renders it natively. Section labels you write on their own line become real headings, and screenshots are embedded inline. Tags stand in for labels, and each list has its own set of statuses.",

    async listTargets() {
      return loadLists();
    },

    async searchIssues(query, opts): Promise<IssueSearchResult[]> {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      try {
        // ClickUp v2 has no full-text task search, so precedent is found by
        // scanning the workspace's recently-updated tasks and matching titles
        // locally. Two pages is enough to see how the workspace files things
        // without turning every ticket into a crawl.
        const limit = Math.min(Math.max(opts?.limit ?? 15, 1), 50);
        const terms = q.split(/\s+/).filter((t) => t.length > 2);
        const hits: IssueSearchResult[] = [];
        for (const teamId of await loadTeams()) {
          for (let page = 0; page < 2; page++) {
            const j = await cuJson<{ tasks?: CuTask[]; last_page?: boolean }>(
              tok,
              `/team/${teamId}/task?page=${page}&order_by=updated&subtasks=true&include_closed=true`,
            );
            for (const t of j.tasks ?? []) {
              const name = (t.name ?? "").toLowerCase();
              if (terms.length ? terms.some((term) => name.includes(term)) : name.includes(q)) {
                hits.push(mapTask(t));
              }
            }
            if (j.last_page || !(j.tasks ?? []).length) break;
            if (hits.length >= limit) break;
          }
          if (hits.length >= limit) break;
        }
        return hits.slice(0, limit);
      } catch {
        return [];
      }
    },

    async getTargetDetails(targetId): Promise<TargetDetails> {
      const lists = await loadLists();
      const target = lists.find((l) => l.id === targetId);
      if (!target) throw unknownList(targetId, lists);
      const [detail, fields, members] = await Promise.all([
        listDetails(targetId),
        listFields(targetId),
        listMembers(targetId),
      ]);
      return {
        id: targetId,
        key: detail.name,
        name: target.name,
        description: detail.content || undefined,
        states: (detail.statuses ?? []).map((s) => s.status),
        // Tags belong to the space. Offering the existing ones steers the
        // agent onto the team's own vocabulary rather than a near-duplicate.
        labels: await spaceTags(detail.space?.id),
        members: members.map(memberName),
        customFields: fields.map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          allowedValues: (f.type_config?.options ?? [])
            .map((o) => o.name ?? o.label ?? "")
            .filter(Boolean),
        })),
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
      // The picked workspace is the org identity, so a list id from any other
      // workspace this person belongs to is refused, not filed into. The walk
      // is normally cached from list_targets, so this costs nothing.
      if (tok.teamId) {
        const lists = await loadLists();
        if (!lists.some((l) => l.id === targetId)) throw unknownList(targetId, lists);
      }

      let statusName: string | undefined;
      if (state) {
        const detail = await listDetails(targetId).catch(() => ({}) as CuList);
        const valid = (detail.statuses ?? []).map((s) => s.status);
        statusName = resolveName(state, valid);
        if (!statusName) console.warn(`[clickup-tracker] no status matched "${state}"`);
      }

      let assigneeIds: number[] | undefined;
      if (assignee) {
        const hit = resolveMember(assignee, await listMembers(targetId));
        if (hit) assigneeIds = [hit.id];
        else console.warn(`[clickup-tracker] no member matched assignee "${assignee}"`);
      }

      // Custom fields go in their own array keyed by field id, and dropdown
      // values must be option ids rather than the names the agent used.
      const custom: Array<{ id: string; value: unknown }> = [];
      const entries = Object.entries(extraFields ?? {});
      if (entries.length) {
        const fields = await listFields(targetId);
        for (const [k, v] of entries) {
          const field = resolveField(fields, k);
          if (!field) continue;
          const value = clickupFieldValue(field, v);
          if (value !== undefined) custom.push({ id: field.id, value });
        }
      }

      const extras: Record<string, unknown> = {
        ...(statusName ? { status: statusName } : {}),
        ...(priority ? { priority: CU_PRIORITY[priority] } : {}),
        ...(assigneeIds ? { assignees: assigneeIds } : {}),
        ...(labels?.length ? { tags: labels } : {}),
        ...(custom.length ? { custom_fields: custom } : {}),
      };

      // The task is created with the text-only body. Evidence can only be
      // uploaded to a task that exists, so it is embedded in a second write.
      const textBody = buildClickUpBody(descriptionMarkdown, [], details);
      const create = (fields: Record<string, unknown>) =>
        cu(tok, `/list/${targetId}/task`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ name: title, ...markdownFields(textBody), ...fields }),
        });

      // Everything beyond the title and body is best-effort: a value the list
      // rejects (400) must not cost the user the whole ticket. Status, tags and
      // custom fields are the values a list can refuse, so they are dropped
      // first; priority and assignee get one more try, then the bare create.
      const kept = Object.fromEntries(
        Object.entries(extras).filter(([k]) => k === "priority" || k === "assignees"),
      );
      const tiers = [extras, kept, {}].filter(
        (t, i, all) => i === 0 || Object.keys(t).length < Object.keys(all[i - 1]).length,
      );
      let res = await create(tiers[0]);
      for (let i = 1; i < tiers.length && !res.ok && res.status === 400; i++) {
        const keep = Object.keys(tiers[i]).join(", ") || "title and body only";
        console.warn(`[clickup-tracker] create rejected, retrying with ${keep}: ${await errText(res)}`);
        res = await create(tiers[i]);
      }
      if (!res.ok) throw new Error(`ClickUp task create failed: ${await errText(res)}`);
      const created = (await res.json()) as CuTask;

      // Attachments are a separate multipart call per file, after the task exists.
      const embeds: ClickUpEmbed[] = [];
      let shotN = 0;
      let recN = 0;
      for (const e of evidence) {
        const kind = evidenceKind(e.contentType);
        // Numbered by successful uploads only, so the name on the attachment
        // and the "Screenshot N" label in the body always agree.
        const n = (kind === "image" ? shotN : recN) + 1;
        try {
          const form = new FormData();
          form.append(
            "attachment",
            new Blob([new Uint8Array(e.bytes)], { type: e.contentType }),
            // ClickUp lists attachments by file name, so the capture's own
            // name would tell the reader how the report was made.
            evidenceFileName(e.contentType, n),
          );
          const r = await cu(tok, `/task/${created.id}/attachment`, { method: "POST", body: form });
          if (!r.ok) {
            console.warn(`[clickup-tracker] attachment ${kind} ${n} failed: ${r.status}`);
            continue;
          }
          const att = (await r.json()) as { url?: string };
          if (!att.url) continue;
          if (kind === "image") shotN = n;
          else recN = n;
          embeds.push(kind === "image" ? { kind, url: att.url, caption: e.caption } : { kind, url: att.url });
        } catch (err) {
          console.warn(`[clickup-tracker] evidence upload failed (${kind} ${n}):`, err);
        }
      }

      // Rewrite the description with the evidence inline. If this write fails
      // the ticket keeps its text-only body, and the files are still on the
      // task's attachment panel.
      if (embeds.length) {
        try {
          const r = await cu(tok, `/task/${created.id}`, {
            method: "PUT",
            headers: JSON_HEADERS,
            body: JSON.stringify(markdownFields(buildClickUpBody(descriptionMarkdown, embeds, details))),
          });
          if (!r.ok) console.warn(`[clickup-tracker] evidence embed failed: ${r.status}`);
        } catch (err) {
          console.warn("[clickup-tracker] evidence embed failed:", err);
        }
      }

      if (comment?.trim()) {
        try {
          await cuJson(tok, `/task/${created.id}/comment`, {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ comment_text: comment.trim(), notify_all: false }),
          });
        } catch (err) {
          console.warn("[clickup-tracker] comment post failed:", err);
        }
      }

      return { id: created.id, identifier: created.id, url: created.url, title: created.name };
    },

    async updateIssue(identifier, patch: IssuePatch): Promise<UpdateResult> {
      try {
        const id = encodeURIComponent(identifier.trim());
        const task = await cuJson<CuTask>(tok, `/task/${id}`);
        const listId = task.list?.id;
        const body: Record<string, unknown> = {};
        if (patch.title) body.name = patch.title;
        if (patch.priority) body.priority = CU_PRIORITY[patch.priority];

        // Everything is resolved BEFORE anything is written, so a bad value
        // reports back without leaving the task half-updated.
        if (patch.state) {
          const detail = listId ? await listDetails(listId) : ({} as CuList);
          const valid = (detail.statuses ?? []).map((s) => s.status);
          const canonical = resolveName(patch.state, valid);
          if (!canonical) {
            return {
              ok: false,
              error: `status "${patch.state}" not found. Valid statuses for this list: ${valid.join(", ")}`,
            };
          }
          body.status = canonical;
        }

        if (patch.assignee) {
          const members = listId ? await listMembers(listId) : [];
          const hit = resolveMember(patch.assignee, members);
          if (!hit) {
            return {
              ok: false,
              error: `assignee "${patch.assignee}" not found. Valid members: ${members.map(memberName).join(", ")}`,
            };
          }
          // ClickUp only adds and removes assignees, so "assign to X" also has
          // to take the previous assignees off or the task ends up with both.
          body.assignees = {
            add: [hit.id],
            rem: (task.assignees ?? []).map((a) => a.id).filter((x) => x !== hit.id),
          };
        }

        const fieldWrites: Array<{ field: CuField; value: unknown }> = [];
        const extraEntries = Object.entries(patch.extraFields ?? {});
        if (extraEntries.length) {
          const fields = listId ? await listFields(listId) : [];
          for (const [k, v] of extraEntries) {
            const field = resolveField(fields, k);
            if (!field) {
              return {
                ok: false,
                error: `custom field "${k}" not found. Valid fields: ${fields.map((f) => `${f.name} (id: ${f.id})`).join(", ")}`,
              };
            }
            const value = clickupFieldValue(field, v);
            if (value === undefined) {
              const opts = (field.type_config?.options ?? [])
                .map((o) => o.name ?? o.label ?? "")
                .filter(Boolean);
              return {
                ok: false,
                error: `value for "${field.name}" is not valid.${opts.length ? ` Allowed values: ${opts.join(", ")}` : ""}`,
              };
            }
            fieldWrites.push({ field, value });
          }
        }

        const tags = (patch.labels ?? []).map((t) => t.trim()).filter(Boolean);
        if (!Object.keys(body).length && !tags.length && !fieldWrites.length) {
          return { ok: false, error: "nothing to update" };
        }

        // What already landed, so a refusal further down can say which part of
        // the patch is done and must not be retried.
        const updated: string[] = [];
        if (Object.keys(body).length) {
          const r = await cu(tok, `/task/${id}`, {
            method: "PUT",
            headers: JSON_HEADERS,
            body: JSON.stringify(body),
          });
          if (!r.ok) return { ok: false, error: `ClickUp update failed: ${await errText(r)}` };
          const SAID: Record<string, string> = { name: "title", assignees: "assignee" };
          updated.push(...Object.keys(body).map((k) => SAID[k] ?? k));
        }

        // Tags and custom fields each have their own endpoint and cannot ride
        // along on the task PUT. Every refusal is collected and reported, with
        // the values that would have worked.
        const refused: string[] = [];
        let validTags: string[] | null = null;
        for (const tag of tags) {
          const r = await cu(tok, `/task/${id}/tag/${encodeURIComponent(tag)}`, { method: "POST" });
          if (r.ok) {
            updated.push(`tag ${tag}`);
            continue;
          }
          const why = await errText(r);
          const valid = (validTags ??= await spaceTags(task.space?.id));
          refused.push(`tag "${tag}" (${why}${valid.length ? `; valid: ${valid.join(", ")}` : ""})`);
        }
        for (const { field, value } of fieldWrites) {
          const r = await cu(tok, `/task/${id}/field/${field.id}`, {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ value }),
          });
          if (r.ok) {
            updated.push(field.name);
            continue;
          }
          const why = await errText(r);
          const opts = (field.type_config?.options ?? [])
            .map((o) => o.name ?? o.label ?? "")
            .filter(Boolean);
          refused.push(`field "${field.name}" (${why}${opts.length ? `; valid: ${opts.join(", ")}` : ""})`);
        }
        if (refused.length) {
          const lead = updated.length ? `Updated ${updated.join(", ")}; refused` : "ClickUp refused";
          return { ok: false, error: `${lead} ${refused.join("; ")}` };
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    async getIssue(identifier) {
      const t = await cuJson<CuTask>(tok, `/task/${encodeURIComponent(identifier.trim())}`);
      return {
        identifier: t.id,
        title: t.name,
        url: t.url,
        list: t.list?.name ?? null,
        state: t.status?.status ?? null,
        stateColor: clickupStatusColor(t.status?.type),
        assignee: t.assignees?.[0]?.username ?? null,
        labels: (t.tags ?? []).map((x) => x.name),
        priority: clickupPriorityName(t.priority),
        customFields: Object.fromEntries(
          (t.custom_fields ?? [])
            .filter((f) => f.value !== undefined && f.value !== null)
            .map((f) => [f.name, clickupFieldDisplay(f)]),
        ),
      };
    },

    async getLiveIssues(identifiers): Promise<LiveIssueLookup> {
      const issues: Record<string, LiveIssue> = {};
      const gone: string[] = [];
      const ids = Array.from(new Set(identifiers.filter(Boolean)));

      // ClickUp has no batch task read, so these are individual gets, a few at
      // a time. ClickUp meters each token per MINUTE (100 requests on most
      // plans), so a 429 means this minute's budget is spent: no further
      // request is sent this sync, and the ids not yet read stay unknown until
      // the next one instead of piling up more 429s.
      const queue = [...ids];
      let throttled = false;
      const worker = async () => {
        for (;;) {
          if (throttled) return;
          const id = queue.shift();
          if (!id) return;
          try {
            const r = await cu(tok, `/task/${encodeURIComponent(id)}`);
            if (r.status === 429) {
              throttled = true;
              return;
            }
            if (r.status === 404) {
              const body = (await r.json().catch(() => null)) as { err?: unknown; ECODE?: unknown } | null;
              // Only ClickUp's own "no such task" is a deletion.
              if (isClickUpTaskMissing(r.status, body)) gone.push(id);
              continue;
            }
            // Anything else (a 401 "team not authorized", a 500) says nothing
            // about whether the task exists, so it is left alone.
            if (!r.ok) continue;
            const t = (await r.json()) as CuTask;
            const a = t.assignees?.[0];
            issues[id] = {
              identifier: t.id,
              title: t.name ?? "",
              url: t.url ?? "",
              stateName: t.status?.status ?? "",
              stateColor: clickupStatusColor(t.status?.type),
              createdAt: t.date_created ? new Date(Number(t.date_created)).toISOString() : "",
              assignee: a
                ? { name: a.username ?? String(a.id), avatarUrl: a.profilePicture ?? undefined }
                : undefined,
            };
          } catch {
            // A transport failure is not evidence of deletion.
            continue;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, ids.length) }, worker));
      return { issues, gone };
    },
  };
}

/**
 * The workspaces this token can see, for the workspace pick on Settings.
 *
 * A ClickUp user can belong to several workspaces at once, and an OAuth grant
 * covers only the ones they ticked on ClickUp's consent screen, which is
 * exactly what `/team` returns. Best-effort: an empty list reads as "nothing
 * to pick", never as an error on the settings page.
 */
export async function listClickUpWorkspaces(token: string): Promise<Workspace[]> {
  try {
    const j = await cuJson<{
      teams?: Array<{ id: string | number; name?: string; avatar?: string | null }>;
    }>({ token }, `/team`);
    return (j.teams ?? []).map((t) => ({
      id: String(t.id),
      name: t.name ?? String(t.id),
      avatarUrl: t.avatar ?? undefined,
    }));
  } catch {
    return [];
  }
}
