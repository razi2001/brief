import {
  DONE_SECTION,
  asanaStateColor,
  enabledOptions,
  evidenceMarkdown,
  findByName,
  findUser,
  homeMembership,
  listNames,
  resolveCustomFields,
  stateName,
  withEvidenceSection,
  type AsanaUploaded,
  type Compact,
  type CustomField,
  type ProjectRaw,
  type TaskRaw,
  type UserRaw,
} from "./asana-body";
import { asanaHtml, asanaPlainText } from "./asana-html";
import { evidenceFileName, evidenceKind, technicalLogsFile } from "./ticket-body";
import {
  NO_CAPABILITIES,
  resolveName,
  withBriefAttribution,
  type IssuePatch,
  type IssueSearchResult,
  type LiveIssue,
  type LiveIssueLookup,
  type TargetDetails,
  type Tracker,
  type TrackerTarget,
  type UpdateResult,
  type Workspace,
} from "./tracker";
import { chunk } from "./ticket-sync";

/**
 * Everything in Asana lives inside one workspace (or organization), and a
 * token can see several. The user picks one when connecting, and every
 * workspace-scoped call (projects, tags, users, search) is made inside it.
 */
export type AsanaTok = { token: string; workspaceGid: string };

const API = "https://app.asana.com/api/1.0";

const AUTH_EXPIRED =
  "Your Asana connection has expired - reconnect Asana under Settings, then retry.";

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

async function asana(tok: { token: string }, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${tok.token}`);
  headers.set("Accept", "application/json");
  // A multipart upload must keep the boundary fetch puts in its own header.
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const r = await fetch(`${API}${path}`, { ...init, headers });
  // OAuth tokens last an hour and the caller refreshes them ahead of expiry,
  // so a 401 here means the refresh itself failed: the user has to reconnect.
  if (r.status === 401) throw new Error(AUTH_EXPIRED);
  return r;
}

/** Asana's own error text, from `{ errors: [{ message }] }`. */
async function asanaError(r: Response): Promise<string> {
  const text = await r.text().catch(() => "");
  try {
    const j = JSON.parse(text) as { errors?: Array<{ message?: string }> };
    const messages = (j.errors ?? []).map((e) => e.message).filter(Boolean);
    if (messages.length) return messages.join("; ");
  } catch {
    /* not JSON - fall back to the raw text */
  }
  return text.slice(0, 300);
}

async function asanaJson<T>(tok: { token: string }, path: string, init: RequestInit = {}): Promise<T> {
  const r = await asana(tok, path, init);
  if (!r.ok) throw new Error(`Asana ${path.split("?")[0]} failed: ${r.status} ${await asanaError(r)}`);
  return ((await r.json()) as { data: T }).data;
}

/**
 * A list endpoint, following `next_page.offset`. Capped at three pages: an
 * organization with thousands of projects or users would otherwise turn one
 * agent turn into dozens of requests, and the first 300 are the useful ones.
 */
async function asanaList<T>(tok: { token: string }, path: string, pages = 3): Promise<T[]> {
  const out: T[] = [];
  let offset: string | undefined;
  for (let p = 0; p < pages; p++) {
    const sep = path.includes("?") ? "&" : "?";
    const url = offset ? `${path}${sep}offset=${encodeURIComponent(offset)}` : path;
    const r = await asana(tok, url);
    if (!r.ok) throw new Error(`Asana ${path.split("?")[0]} failed: ${r.status} ${await asanaError(r)}`);
    const j = (await r.json()) as { data?: T[]; next_page?: { offset?: string } | null };
    out.push(...(j.data ?? []));
    offset = j.next_page?.offset ?? undefined;
    if (!offset) break;
  }
  return out;
}

/** Every Asana request and response body is wrapped in `{ data }`. */
const wrap = (data: unknown) => JSON.stringify({ data });

/** Task, project and attachment ids are numeric strings ("gid"). */
function isGid(s: string): boolean {
  return /^\d+$/.test((s ?? "").trim());
}

/** Asana resolves this form to the task wherever it lives. */
function taskUrl(gid: string): string {
  return `https://app.asana.com/0/0/${gid}`;
}

// ---------------------------------------------------------------------------
// Tracker implementation
// ---------------------------------------------------------------------------

const DONE_STATE = /^(done|complete|completed|closed)$/i;
const REOPEN_STATE = /^(open|reopen|reopened|incomplete)$/i;

const ISSUE_FIELDS = [
  "name",
  "completed",
  "assignee.name",
  "memberships.section.name",
  "memberships.project.name",
  "tags.name",
  "custom_fields.name",
  "custom_fields.display_value",
  "permalink_url",
].join(",");

const SEARCH_FIELDS = [
  "name",
  "permalink_url",
  "completed",
  "assignee.name",
  "memberships.project.name",
  "memberships.section.name",
  "tags.name",
].join(",");

const LIVE_FIELDS = [
  "name",
  "completed",
  "permalink_url",
  "created_at",
  "assignee.name",
  "assignee.photo.image_60x60",
  "memberships.project.name",
  "memberships.section.name",
];

/** Memoize a loader per key, keeping only successes so a blip is retried. */
function cached<T>(map: Map<string, T>, key: string, load: () => Promise<T>): Promise<T> {
  const hit = map.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  return load().then((v) => {
    map.set(key, v);
    return v;
  });
}

export function makeAsanaTracker(tok: AsanaTok): Tracker {
  const ws = tok.workspaceGid;
  const projectsCache = new Map<string, TrackerTarget[]>();
  const sectionsCache = new Map<string, Compact[]>();
  const fieldsCache = new Map<string, CustomField[]>();
  const tagsCache = new Map<string, Compact[]>();
  const usersCache = new Map<string, UserRaw[]>();

  const loadProjects = () =>
    cached(projectsCache, ws, async () => {
      const raw = await asanaList<ProjectRaw>(
        tok,
        `/projects?workspace=${ws}&archived=false&limit=100&opt_fields=name,notes,team.name`,
      );
      return raw.map((p) => {
        const name = p.name ?? p.gid;
        const notes = (p.notes ?? "").trim();
        return {
          id: p.gid,
          key: p.gid,
          // Project names repeat across teams ("Bugs" in every team), so the
          // team is what tells the agent which one is meant.
          name: p.team?.name ? `${p.team.name} / ${name}` : name,
          description: notes ? notes.slice(0, 200) : undefined,
        };
      });
    });

  const loadSections = (project: string) =>
    cached(sectionsCache, project, () =>
      asanaList<Compact>(tok, `/projects/${project}/sections?opt_fields=name`),
    );

  const loadFields = (project: string) =>
    cached(fieldsCache, project, async () => {
      const settings = await asanaList<{ custom_field?: CustomField | null }>(
        tok,
        `/projects/${project}/custom_field_settings?opt_fields=custom_field.gid,custom_field.name,custom_field.resource_subtype,custom_field.enum_options.name,custom_field.enum_options.enabled`,
      );
      return settings.map((s) => s.custom_field).filter((f): f is CustomField => !!f?.gid);
    });

  const loadTags = () =>
    cached(tagsCache, ws, () => asanaList<Compact>(tok, `/workspaces/${ws}/tags?limit=100&opt_fields=name`));

  const loadUsers = () =>
    cached(usersCache, ws, () =>
      asanaList<UserRaw>(tok, `/users?workspace=${ws}&limit=100&opt_fields=name,email`),
    );

  /** A project gid, from a gid or (forgivingly) from a project's name. */
  async function projectGid(targetId: string): Promise<string> {
    const id = (targetId ?? "").trim();
    if (isGid(id)) return id;
    const projects = await loadProjects();
    const name = resolveName(id, projects.map((p) => p.name));
    const hit = projects.find((p) => p.name.toLowerCase() === id.toLowerCase()) ?? projects.find((p) => p.name === name);
    if (hit) return hit.id;
    throw new Error(
      `Asana: "${targetId}" is not a project id. Known projects: ${listNames(projects.map((p) => `${p.name} (${p.id})`))}`,
    );
  }

  /**
   * The project a target names, and only when it belongs to the picked
   * workspace. That pick is the org identity, so a project gid from any other
   * workspace this person belongs to is refused, never filed into. The
   * listing is normally cached from list_targets, so this costs nothing; it
   * stops at three pages, so a project past them is read once, and its own
   * workspace decides.
   */
  async function workspaceProject(
    targetId: string,
  ): Promise<{ gid: string; name?: string; description?: string }> {
    const gid = await projectGid(targetId);
    const known = await loadProjects().catch(() => [] as TrackerTarget[]);
    const listed = known.find((p) => p.id === gid);
    if (listed) return { gid, name: listed.name, description: listed.description };
    const p = await asanaJson<ProjectRaw & { workspace?: Compact | null }>(
      tok,
      `/projects/${gid}?opt_fields=name,notes,workspace`,
    ).catch(() => null);
    if (!p || p.workspace?.gid !== ws) {
      throw new Error(
        `Asana: no project "${targetId}" in this workspace. Known projects: ${listNames(known.map((k) => `${k.name} (${k.id})`))}`,
      );
    }
    return { gid, name: p.name, description: p.notes?.trim() ? p.notes.trim().slice(0, 200) : undefined };
  }

  /**
   * Attach one file to a task. Best-effort: a failed upload costs that one
   * piece of evidence, never the task that already exists.
   */
  async function upload(
    taskGid: string,
    name: string,
    contentType: string,
    bytes: Buffer,
  ): Promise<{ gid: string; permanent_url?: string } | null> {
    try {
      const form = new FormData();
      form.append("parent", taskGid);
      // "asana" = the file itself is stored on Asana, not linked from elsewhere.
      form.append("resource_subtype", "asana");
      form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), name);
      const r = await asana(tok, "/attachments?opt_fields=permanent_url", { method: "POST", body: form });
      if (!r.ok) {
        console.warn(`[asana-tracker] attachment ${name} failed: ${r.status} ${await asanaError(r)}`);
        return null;
      }
      const att = ((await r.json()) as { data?: { gid?: string; permanent_url?: string } }).data;
      return att?.gid ? { gid: att.gid, permanent_url: att.permanent_url } : null;
    } catch (err) {
      console.warn(`[asana-tracker] attachment ${name} error:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  /** One cheap read: does this token's user still belong to the workspace? */
  async function stillInWorkspace(): Promise<boolean> {
    try {
      const me = await asanaJson<{ workspaces?: Compact[] }>(tok, "/users/me?opt_fields=workspaces");
      return (me.workspaces ?? []).some((w) => w.gid === ws);
    } catch {
      return false;
    }
  }

  return {
    kind: "asana",
    targetNoun: "project",
    capabilities: {
      ...NO_CAPABILITIES,
      // A project's sections are its workflow columns.
      states: true,
      // Through the project's own Priority custom field, when it has one.
      priority: true,
      // Workspace tags.
      labels: true,
      customFields: true,
      comments: true,
      nativeAttachments: true,
    },
    bodyGuidance: "Asana notes support headings, bold, italics, lists, links and code blocks.",

    async listTargets() {
      return loadProjects();
    },

    async searchIssues(query, opts): Promise<IssueSearchResult[]> {
      const q = query.trim();
      if (!q) return [];
      try {
        // Typeahead, not /tasks/search: full-text task search is a Premium
        // feature, and a free workspace would answer it with a 402 every time.
        const count = Math.min(Math.max(opts?.limit ?? 10, 1), 100);
        const tasks = await asanaJson<TaskRaw[]>(
          tok,
          `/workspaces/${ws}/typeahead?resource_type=task&query=${encodeURIComponent(q)}&count=${count}&opt_fields=${SEARCH_FIELDS}`,
        );
        return (tasks ?? []).map((t) => ({
          identifier: t.gid,
          title: t.name ?? "",
          url: t.permalink_url ?? taskUrl(t.gid),
          target: homeMembership(t)?.project?.name ?? "",
          state: stateName(t),
          labels: (t.tags ?? []).map((x) => x.name ?? "").filter(Boolean),
          assignee: t.assignee?.name ?? undefined,
        }));
      } catch {
        return [];
      }
    },

    async getTargetDetails(targetId): Promise<TargetDetails> {
      // A project Asana cannot find, or one in another workspace, is an error
      // the agent can act on, not an empty target it would file into and fail.
      const { gid: project, name, description } = await workspaceProject(targetId);
      // Each part on its own: a workspace that hides its member list must not
      // also cost the agent the project's sections.
      const [sections, tags, users, fields] = await Promise.all([
        loadSections(project).catch(() => [] as Compact[]),
        loadTags().catch(() => [] as Compact[]),
        loadUsers().catch(() => [] as UserRaw[]),
        loadFields(project).catch(() => [] as CustomField[]),
      ]);

      return {
        id: project,
        key: project,
        name: name ?? project,
        description,
        states: sections.map((s) => s.name ?? "").filter(Boolean),
        labels: tags.map((t) => t.name ?? "").filter(Boolean),
        members: users.map((u) => u.name ?? "").filter(Boolean),
        customFields: fields.map((f) => {
          const options = enabledOptions(f).map((o) => o.name);
          return {
            id: f.gid,
            name: f.name,
            type: f.resource_subtype ?? "unknown",
            ...(f.resource_subtype === "enum" || f.resource_subtype === "multi_enum"
              ? { allowedValues: options.slice(0, 50) }
              : {}),
          };
        }),
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
      const { gid: project } = await workspaceProject(targetId);

      // Everything below is best-effort: a lookup that fails resolves nothing,
      // and the task is filed without that one extra.
      const hasExtras = Object.keys(extraFields ?? {}).length > 0;
      const [sections, fields, tags, users] = await Promise.all([
        state?.trim() ? loadSections(project).catch(() => [] as Compact[]) : [],
        priority || hasExtras ? loadFields(project).catch(() => [] as CustomField[]) : [],
        labels?.length ? loadTags().catch(() => [] as Compact[]) : [],
        assignee?.trim() || hasExtras ? loadUsers().catch(() => [] as UserRaw[]) : [],
      ]);

      const section = state?.trim() ? findByName(sections, state) : undefined;
      const extras: Record<string, unknown> = {};
      const assigneeGid = assignee?.trim() ? findUser(users, assignee) : undefined;
      if (assigneeGid) extras.assignee = assigneeGid;
      // Existing tags only: creating one on a typo would pollute the
      // workspace's tag list for everyone in it.
      const tagGids = (labels ?? [])
        .map((l) => findByName(tags, l)?.gid)
        .filter((g): g is string => !!g);
      if (tagGids.length) extras.tags = Array.from(new Set(tagGids));
      if (priority || hasExtras) {
        const cf = resolveCustomFields(fields, extraFields, priority, users);
        if (cf.errors.length) console.warn(`[asana-tracker] fields skipped: ${cf.errors.join(" ")}`);
        if (Object.keys(cf.values).length) extras.custom_fields = cf.values;
      }

      const body = withBriefAttribution(descriptionMarkdown ?? "");

      // Asana rejects the WHOLE create over one bad value, so a 400 retries
      // with less, dropping only what the error points at:
      //  - an error about the notes (html_notes, or the XML in it) switches to
      //    plain-text notes and KEEPS the extras, which were never the problem;
      //  - any other 400 drops the extras (an assignee outside the workspace,
      //    a field the project no longer has);
      //  - a 400 with nothing left to drop tries plain text as a last resort.
      // So the report always lands, at worst without formatting or extras.
      let useHtml = true;
      let useExtras = Object.keys(extras).length > 0;
      let created: TaskRaw | null = null;
      let lastError = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await asana(tok, "/tasks?opt_fields=name,permalink_url", {
          method: "POST",
          body: wrap({
            name: title,
            ...(useHtml ? { html_notes: asanaHtml(body) } : { notes: asanaPlainText(body) }),
            // Always `projects`, never create-time `memberships`: the section
            // is applied afterwards, where its failure costs nothing else.
            projects: [project],
            ...(useExtras ? extras : {}),
          }),
        });
        if (r.ok) {
          created = ((await r.json()) as { data: TaskRaw }).data;
          break;
        }
        const message = await asanaError(r);
        lastError = `${r.status} ${message}`;
        // Only a 400 is about what we sent; anything else will fail again.
        if (r.status !== 400) break;
        console.warn(`[asana-tracker] create rejected (${lastError})`);
        if (useHtml && /html_notes|xml/i.test(message)) useHtml = false;
        else if (useExtras) useExtras = false;
        else if (useHtml) useHtml = false;
        else break;
      }
      if (!created?.gid) throw new Error(`Asana task create failed: ${lastError}`);
      const gid = created.gid;
      const htmlNotes = useHtml;

      // The section, on its own call: a project whose sections changed since
      // we read them, or a move Asana refuses, leaves the task in the
      // project's first section with every other field intact.
      if (section) {
        try {
          const r = await asana(tok, `/sections/${section.gid}/addTask`, {
            method: "POST",
            body: wrap({ task: gid }),
          });
          if (!r.ok) console.warn(`[asana-tracker] section "${section.name}" not applied: ${r.status} ${await asanaError(r)}`);
        } catch (err) {
          console.warn("[asana-tracker] section error:", err instanceof Error ? err.message : err);
        }
      }

      // Inline images must reference attachments already on the task, so the
      // task is created first, the evidence attached, and the notes rewritten.
      const uploaded: AsanaUploaded[] = [];
      let shots = 0;
      let recordings = 0;
      for (const e of evidence ?? []) {
        const kind = evidenceKind(e.contentType);
        const n = kind === "image" ? ++shots : ++recordings;
        const att = await upload(gid, evidenceFileName(e.contentType, n), e.contentType, e.bytes);
        if (att) {
          uploaded.push({
            kind,
            gid: att.gid,
            caption: e.caption,
            url: att.permanent_url,
          });
        }
      }

      if (uploaded.length && htmlNotes) {
        const notes = asanaHtml(
          withBriefAttribution(withEvidenceSection(descriptionMarkdown ?? "", evidenceMarkdown(uploaded))),
        );
        try {
          const r = await asana(tok, `/tasks/${gid}`, { method: "PUT", body: wrap({ html_notes: notes }) });
          // The first notes stay, and the files still show on the task.
          if (!r.ok) console.warn(`[asana-tracker] inline evidence not applied: ${r.status} ${await asanaError(r)}`);
        } catch (err) {
          console.warn("[asana-tracker] inline evidence error:", err instanceof Error ? err.message : err);
        }
      }

      // Asana notes are no place for pages of network calls, so the logs ride
      // along as an attachment the notes never mention. Last, so the
      // screenshots come first in the task's attachment strip.
      const logs = technicalLogsFile(details);
      if (logs) await upload(gid, logs.filename, logs.contentType, logs.bytes);

      if (comment?.trim()) {
        try {
          const r = await asana(tok, `/tasks/${gid}/stories`, {
            method: "POST",
            body: wrap({ text: comment.trim() }),
          });
          if (!r.ok) console.warn(`[asana-tracker] comment failed: ${r.status} ${await asanaError(r)}`);
        } catch (err) {
          console.warn("[asana-tracker] comment error:", err instanceof Error ? err.message : err);
        }
      }

      return {
        id: gid,
        identifier: gid,
        url: created.permalink_url ?? taskUrl(gid),
        title: created.name ?? title,
      };
    },

    async updateIssue(identifier, patch: IssuePatch): Promise<UpdateResult> {
      const gid = (identifier ?? "").trim();
      if (!isGid(gid)) return { ok: false, error: `"${identifier}" is not an Asana task id (expected its numeric gid)` };
      try {
        // Resolve everything before writing anything, so a bad value leaves
        // the task untouched rather than half-updated.
        const data: Record<string, unknown> = {};
        if (patch.title?.trim()) data.name = patch.title.trim();

        if (patch.assignee?.trim()) {
          const users = await loadUsers();
          const u = findUser(users, patch.assignee);
          if (!u) {
            return {
              ok: false,
              error: `Unknown assignee "${patch.assignee}". Valid: ${listNames(users.map((x) => x.name))}`,
            };
          }
          data.assignee = u;
        }

        let tagGids: string[] = [];
        if (patch.labels?.length) {
          const tags = await loadTags();
          const missing: string[] = [];
          for (const l of patch.labels) {
            const tag = findByName(tags, l);
            if (tag) tagGids.push(tag.gid);
            else missing.push(l);
          }
          if (missing.length) {
            return {
              ok: false,
              error: `Unknown tags: ${missing.join(", ")}. Valid: ${listNames(tags.map((t) => t.name))}`,
            };
          }
          tagGids = Array.from(new Set(tagGids));
        }

        const hasExtras = Object.keys(patch.extraFields ?? {}).length > 0;
        let section: Compact | undefined;
        if (patch.state?.trim() || patch.priority || hasExtras) {
          const task = await asanaJson<TaskRaw>(
            tok,
            `/tasks/${gid}?opt_fields=projects.name,memberships.project.name`,
          );
          const project = homeMembership(task)?.project?.gid ?? task.projects?.[0]?.gid;

          const want = patch.state?.trim();
          if (want) {
            const sections = project ? await loadSections(project) : [];
            section = findByName(sections, want);
            // A finished task in Asana is a completed one, and most projects
            // have no "Done" section; only a real section of that name wins.
            if (section) {
              // Moving a completed task back into "In progress" means it is
              // open again; a task left completed there would still read Done.
              if (!DONE_SECTION.test(section.name ?? "")) data.completed = false;
            } else if (DONE_STATE.test(want)) data.completed = true;
            else if (REOPEN_STATE.test(want)) data.completed = false;
            else {
              return {
                ok: false,
                error: `Unknown section "${want}". Valid: ${listNames(sections.map((s) => s.name))}, or "Done" to complete the task.`,
              };
            }
          }

          if (patch.priority || hasExtras) {
            const fields = project ? await loadFields(project) : [];
            const users = hasExtras ? await loadUsers().catch(() => [] as UserRaw[]) : [];
            const cf = resolveCustomFields(fields, patch.extraFields, patch.priority, users);
            if (cf.errors.length) return { ok: false, error: cf.errors.join(" ") };
            if (Object.keys(cf.values).length) data.custom_fields = cf.values;
          }
        }

        if (!Object.keys(data).length && !section && !tagGids.length) {
          return { ok: false, error: "nothing to update" };
        }

        if (Object.keys(data).length) {
          const r = await asana(tok, `/tasks/${gid}`, { method: "PUT", body: wrap(data) });
          if (!r.ok) return { ok: false, error: `Asana update failed: ${r.status} ${await asanaError(r)}` };
        }
        if (section) {
          const r = await asana(tok, `/sections/${section.gid}/addTask`, {
            method: "POST",
            body: wrap({ task: gid }),
          });
          if (!r.ok) {
            return { ok: false, error: `Moving the task to "${section.name}" failed: ${r.status} ${await asanaError(r)}` };
          }
        }
        for (const tag of tagGids) {
          const r = await asana(tok, `/tasks/${gid}/addTag`, { method: "POST", body: wrap({ tag }) });
          if (!r.ok) return { ok: false, error: `Adding a tag failed: ${r.status} ${await asanaError(r)}` };
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    async getIssue(identifier) {
      const gid = (identifier ?? "").trim();
      if (!isGid(gid)) throw new Error(`"${identifier}" is not an Asana task id (expected its numeric gid)`);
      const t = await asanaJson<TaskRaw>(tok, `/tasks/${gid}?opt_fields=${ISSUE_FIELDS}`);
      const home = homeMembership(t);
      const customFields = Object.fromEntries(
        (t.custom_fields ?? [])
          .filter((f) => f.name)
          .map((f) => [f.name as string, f.display_value ?? null]),
      );
      const priority = (t.custom_fields ?? []).find((f) => /priority/i.test(f.name ?? ""));
      return {
        identifier: t.gid,
        title: t.name ?? "",
        url: t.permalink_url ?? taskUrl(t.gid),
        // The section is the meaningful "state", so the agent's verify step
        // reads back exactly what it set.
        state: stateName(t),
        completed: !!t.completed,
        section: home?.section?.name ?? null,
        project: home?.project?.name ?? null,
        assignee: t.assignee?.name ?? null,
        tags: (t.tags ?? []).map((x) => x.name ?? "").filter(Boolean),
        priority: priority?.display_value ?? null,
        customFields,
      };
    },

    async getLiveIssues(identifiers): Promise<LiveIssueLookup> {
      const issues: Record<string, LiveIssue> = {};
      // Tasks Asana answered 404 for. Not yet "gone": see below.
      const missing: string[] = [];
      const gids = Array.from(new Set(identifiers.filter((id) => isGid(id)).map((id) => id.trim())));

      // The batch API takes at most ten actions per call, so a feed of 50
      // tickets costs five requests rather than fifty.
      for (const batch of chunk(gids, 10)) {
        try {
          const r = await asana(tok, "/batch", {
            method: "POST",
            body: wrap({
              actions: batch.map((g) => ({
                method: "get",
                relative_path: `/tasks/${g}`,
                options: { fields: LIVE_FIELDS },
              })),
            }),
          });
          // A failed batch says nothing about whether these tasks exist, so it
          // leaves `gone` alone and the rows fall back to their snapshot.
          if (!r.ok) continue;
          const results = ((await r.json()) as {
            data?: Array<{ status_code?: number; body?: { data?: TaskRaw } | null }>;
          }).data ?? [];

          batch.forEach((g, i) => {
            const res = results[i];
            if (!res) return;
            // Asana answers 404 for a deleted task, but ALSO for one this token
            // can no longer see. A 403 is a permission change too, and is left
            // alone like any other failure.
            if (res.status_code === 404) {
              missing.push(g);
              return;
            }
            const t = res.status_code === 200 ? res.body?.data : undefined;
            if (!t) return;
            const section = homeMembership(t)?.section?.name ?? undefined;
            issues[g] = {
              identifier: g,
              title: t.name ?? "",
              url: t.permalink_url ?? taskUrl(g),
              stateName: stateName(t),
              stateColor: asanaStateColor(!!t.completed, section),
              createdAt: t.created_at ?? "",
              assignee: t.assignee?.name
                ? { name: t.assignee.name, avatarUrl: t.assignee.photo?.image_60x60 ?? undefined }
                : undefined,
            };
          });
        } catch {
          // An outage (or an expired token) must never break the feed.
          continue;
        }
      }

      // "Unknown object" is also what a task looks like once the person is
      // removed from the workspace, or reconnects as another account: every
      // row would flip to Deleted at once. So the 404s count only when the
      // token provably still belongs to the workspace those tasks live in.
      const gone = missing.length && (await stillInWorkspace()) ? missing : [];
      return { issues, gone };
    },
  };
}

/**
 * The workspaces this token can see, for the workspace pick under Settings.
 * Most people have exactly one, and the pick also scopes filing: projects,
 * tags and people all live inside a workspace. Empty on any failure.
 */
export async function listAsanaWorkspaces(token: string): Promise<Workspace[]> {
  try {
    const all = await asanaList<Compact>({ token }, "/workspaces?limit=100&opt_fields=name");
    return all.map((w) => ({ id: w.gid, name: w.name ?? w.gid }));
  } catch {
    return [];
  }
}
