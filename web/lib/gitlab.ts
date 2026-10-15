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
import { describeRepo, evidenceFileName, evidenceKind, withDetailsFolds } from "./ticket-body";
import {
  buildGitlabBody,
  gitlabPriorityLabel,
  gitlabStateColor,
  labelScope,
  liveStateName,
  priorityOf,
  samePriorityFamily,
  statesOf,
  statusLabels,
  type GitlabEmbed,
} from "./gitlab-body";
import { chunk } from "./ticket-sync";

export type GitlabTok = { token: string; baseUrl?: string };

const AUTH_EXPIRED =
  "Your GitLab connection has expired - reconnect GitLab under Settings, then retry.";

const SCOPE_MISSING =
  "Your GitLab connection cannot create issues (it lacks the api scope) - reconnect GitLab under Settings, then retry.";

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/**
 * GitLab issue iids are only unique within a project, and projects nest under
 * any depth of subgroups ("acme/platform/web#12"). Brief's identifier is
 * GitLab's own `references.full`, so everything before the LAST "#" is the
 * project path and the digits after it are the iid.
 */
export function parseGitlabRef(identifier: string): { path: string; iid: number } | null {
  const m = /^(.+)#(\d+)$/.exec((identifier ?? "").trim());
  if (!m || /\s/.test(m[1])) return null;
  return { path: m[1], iid: Number(m[2]) };
}

/**
 * A project is addressable by numeric id or by its full path, but the path has
 * to be URL-encoded as ONE segment ("a/b" -> "a%2Fb") or GitLab reads it as a
 * route.
 */
function projectRef(idOrPath: string | number): string {
  return encodeURIComponent(String(idOrPath).trim());
}

/** The fully qualified reference, even from an envelope that lacks one. */
function refOf(issue: IssueRaw): string {
  if (issue.references?.full) return issue.references.full;
  // Older instances omit `references`; the web URL carries the same path.
  const m = /^https?:\/\/[^/]+\/(.+?)\/-\/issues\/(?:incident\/)?(\d+)/.exec(issue.web_url ?? "");
  return m ? `${m[1]}#${m[2]}` : `#${issue.iid}`;
}

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

function apiBase(tok: GitlabTok): string {
  return `${(tok.baseUrl ?? "https://gitlab.com").replace(/\/+$/, "")}/api/v4`;
}

async function gl(tok: GitlabTok, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${tok.token}`);
  // Only a JSON body gets a JSON content type: a multipart upload has to keep
  // the boundary fetch generates for its FormData.
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const r = await fetch(`${apiBase(tok)}${path}`, { ...init, headers });
  if (r.status === 401) throw new Error(AUTH_EXPIRED);
  return r;
}

/**
 * A response body made safe to log or show. GitLab does not echo credentials,
 * but a proxy or self-hosted error page in front of it can, and these texts
 * end up in warnings and in the agent's error messages.
 */
function redact(tok: GitlabTok, text: string): string {
  return tok.token ? text.split(tok.token).join("[redacted]") : text;
}

/** An error for a failed call: the path and GitLab's answer, never the token. */
async function failure(tok: GitlabTok, r: Response, path: string): Promise<Error> {
  const text = redact(tok, (await r.text().catch(() => "")).slice(0, 500));
  // A token granted read_api only answers 403 insufficient_scope on every
  // write, and "403" alone would not tell the user to reconnect.
  if (r.status === 403 && /insufficient_scope/i.test(text)) return new Error(SCOPE_MISSING);
  return new Error(`GitLab ${path.split("?")[0]} failed: ${r.status} ${text}`);
}

async function glJson<T>(tok: GitlabTok, path: string, init: RequestInit = {}): Promise<T> {
  const r = await gl(tok, path, init);
  if (!r.ok) throw await failure(tok, r, path);
  return (await r.json()) as T;
}

/**
 * Follow GitLab's `x-next-page` header for a bounded number of pages. Only the
 * first page may fail the call: a later page failing leaves what was already
 * read, which beats losing the whole list over one bad page.
 */
async function glPages<T>(tok: GitlabTok, path: string, maxPages: number): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  for (let n = 0; n < maxPages; n++) {
    const url = page > 1 ? `${path}${path.includes("?") ? "&" : "?"}page=${page}` : path;
    let r: Response;
    try {
      r = await gl(tok, url);
    } catch (e) {
      if (n === 0) throw e;
      break;
    }
    if (!r.ok) {
      if (n === 0) throw await failure(tok, r, path);
      break;
    }
    out.push(...((await r.json()) as T[]));
    const next = Number(r.headers.get("x-next-page") || 0);
    if (!next) break;
    page = next;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

type MemberRaw = { id: number; username: string; name: string; state?: string; avatar_url?: string | null };
type MilestoneRaw = { id: number; title: string };

/** How a member is shown to the agent, and the form it is most likely to send back. */
function memberLabel(m: MemberRaw): string {
  return `${m.name} (@${m.username})`;
}

/** Match "Ada", "ada", "@ada" or "Ada Lovelace (@ada)" to one member. */
function resolveMember(want: string, members: MemberRaw[]): MemberRaw | undefined {
  const byCandidate = new Map<string, MemberRaw>();
  for (const m of members) {
    for (const c of [memberLabel(m), m.name, m.username]) {
      if (c && !byCandidate.has(c)) byCandidate.set(c, m);
    }
  }
  const hit = resolveName(want.replace(/^@/, ""), [...byCandidate.keys()]);
  return hit ? byCandidate.get(hit) : undefined;
}

const ISSUE_TYPES = ["issue", "incident"];

/** The extra fields getTargetDetails offers, and the only ones accepted. */
const EXTRA_FIELDS = ["milestone", "due_date", "weight", "confidential", "issue_type"];

/**
 * The agent's extraFields, as GitLab API fields. `milestone` is a title the
 * agent can read, mapped to the id GitLab wants; the rest are checked so a
 * malformed value is caught here. In strict mode (updateIssue) the first bad
 * value is reported back; otherwise (fileIssue) it is dropped, because an
 * extra must never fail a filing.
 *
 * Only the offered fields pass. A raw `description` or `title` would replace
 * the body with its evidence and attribution, and raw labels would make GitLab
 * create labels the project does not have.
 */
function gitlabExtraFields(
  extra: Record<string, unknown> | undefined,
  milestones: MilestoneRaw[],
  strict: boolean,
): { fields: Record<string, unknown>; error?: string } {
  const fields: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value === undefined) continue;
    const clear = value === null || value === "";
    switch (key) {
      case "milestone": {
        // GitLab unassigns the milestone on id 0.
        if (clear) {
          fields.milestone_id = 0;
          break;
        }
        const titles = milestones.map((m) => m.title);
        const hit = typeof value === "string" ? resolveName(value, titles) : undefined;
        const m = milestones.find((x) => x.title === hit);
        if (m) fields.milestone_id = m.id;
        else errors.push(`Unknown milestone "${String(value)}". Valid: ${titles.join(", ") || "(none)"}`);
        break;
      }
      case "due_date": {
        if (clear) {
          fields.due_date = null;
          break;
        }
        const s = typeof value === "string" ? value.trim().slice(0, 10) : "";
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) fields.due_date = s;
        else errors.push(`Invalid due_date "${String(value)}". Use YYYY-MM-DD.`);
        break;
      }
      case "weight": {
        const n = typeof value === "number" ? value : Number(String(value).trim());
        if (Number.isInteger(n) && n >= 0) fields.weight = n;
        else errors.push(`Invalid weight "${String(value)}". Use a whole number, 0 or more.`);
        break;
      }
      case "confidential": {
        const b = value === true || value === "true" ? true : value === false || value === "false" ? false : null;
        if (b !== null) fields.confidential = b;
        else errors.push(`Invalid confidential "${String(value)}". Use true or false.`);
        break;
      }
      case "issue_type": {
        const t = String(value).trim().toLowerCase();
        if (ISSUE_TYPES.includes(t)) fields.issue_type = t;
        else errors.push(`Unknown issue_type "${String(value)}". Valid: ${ISSUE_TYPES.join(", ")}`);
        break;
      }
      default:
        errors.push(`Unknown field "${key}". Valid: ${EXTRA_FIELDS.join(", ")}`);
    }
  }
  if (errors.length) {
    if (strict) return { fields, error: errors[0] };
    console.warn("[gitlab-tracker] extra fields dropped:", errors.join("; "));
  }
  return { fields };
}

// ---------------------------------------------------------------------------
// Tracker implementation
// ---------------------------------------------------------------------------

type ProjectRaw = {
  id: number;
  name: string;
  name_with_namespace: string;
  path_with_namespace: string;
  description: string | null;
  topics?: string[];
};

type UserRaw = { id: number; username: string; name: string; avatar_url?: string | null };

type IssueRaw = {
  id: number;
  iid: number;
  project_id?: number;
  title: string;
  state: string;
  created_at: string;
  updated_at?: string;
  labels?: string[];
  assignees?: UserRaw[];
  milestone?: { id: number; title: string } | null;
  web_url: string;
  references?: { short?: string; relative?: string; full?: string };
  due_date?: string | null;
  weight?: number | null;
  confidential?: boolean;
  issue_type?: string;
};

type UploadRaw = { url?: string; markdown?: string };

/** Members a ticket can be assigned to: active humans, not project/group access-token bots. */
function assignable(members: MemberRaw[]): MemberRaw[] {
  return members.filter(
    (m) => (!m.state || m.state === "active") && !/^(project|group)_\d+_bot/.test(m.username),
  );
}

function liveIssue(issue: IssueRaw): LiveIssue {
  const closed = issue.state === "closed";
  const labels = issue.labels ?? [];
  const a = issue.assignees?.[0];
  return {
    // references.full follows the issue when its project is renamed or moved.
    identifier: refOf(issue),
    title: issue.title ?? "",
    url: issue.web_url ?? "",
    stateName: liveStateName(closed, labels),
    stateColor: gitlabStateColor(closed, labels),
    createdAt: issue.created_at ?? "",
    assignee: a?.name ? { name: a.name, avatarUrl: a.avatar_url ?? undefined } : undefined,
  };
}

/**
 * How many of the most recently active projects a precedent search covers.
 * Every project costs one search request, and GitLab rate-limits searches per
 * user, so this stays small.
 */
const SEARCH_PROJECTS = 5;

export function makeGitlabTracker(tok: GitlabTok): Tracker {
  // The promise, not its result, is cached, so a search and a details call
  // racing each other share one listing instead of fetching it twice.
  let projectsLoad: Promise<ProjectRaw[]> | null = null;

  function loadProjects(): Promise<ProjectRaw[]> {
    if (!projectsLoad) {
      // Reporter or above, issues on, not archived: anything else is not a
      // place a ticket can land, and offering it would only fail the filing.
      projectsLoad = glPages<ProjectRaw>(
        tok,
        "/projects?membership=true&min_access_level=20&archived=false&with_issues_enabled=true&order_by=last_activity_at&per_page=100",
        2,
      ).catch((e) => {
        // A failed listing is not remembered; the next call tries again.
        projectsLoad = null;
        throw e;
      });
    }
    return projectsLoad;
  }

  function toTarget(p: ProjectRaw): TrackerTarget {
    return {
      id: String(p.id),
      key: p.path_with_namespace,
      name: p.name_with_namespace,
      // GitLab has no homepage field, so the description and topics are the
      // routing signal.
      description: describeRepo({ description: p.description, topics: p.topics }),
    };
  }

  // Each loader throws in strict mode (updateIssue reports what went wrong)
  // and degrades to an empty list otherwise (fileIssue's extras are best-effort).
  async function projectLabels(proj: string, strict = false): Promise<string[]> {
    const read = glPages<{ name: string }>(
      tok,
      `/projects/${proj}/labels?per_page=100&include_ancestor_groups=true`,
      3,
    ).then((ls) => ls.map((l) => l.name));
    return strict ? read : read.catch(() => []);
  }

  async function projectMembers(proj: string, strict = false): Promise<MemberRaw[]> {
    const read = glPages<MemberRaw>(tok, `/projects/${proj}/members/all?per_page=100`, 2).then(assignable);
    return strict ? read : read.catch(() => []);
  }

  async function projectMilestones(proj: string, strict = false): Promise<MilestoneRaw[]> {
    const read = glJson<MilestoneRaw[]>(
      tok,
      `/projects/${proj}/milestones?state=active&per_page=50&include_ancestors=true`,
    );
    return strict ? read : read.catch(() => []);
  }

  return {
    kind: "gitlab",
    targetNoun: "project",
    capabilities: {
      ...NO_CAPABILITIES,
      // Status and priority are labels by convention; the adapter resolves
      // them against the project's own label set.
      states: true,
      priority: true,
      labels: true,
      // Milestone, due date, weight, confidential and issue type.
      customFields: true,
      comments: true,
      nativeAttachments: true,
    },
    bodyGuidance: "GitLab renders Markdown; section labels become headings.",

    async listTargets() {
      return (await loadProjects()).map(toTarget);
    },

    async searchIssues(query, opts): Promise<IssueSearchResult[]> {
      const q = query.trim();
      if (!q) return [];
      try {
        // GET /issues?scope=all is NOT "issues I can see in my projects": on
        // gitlab.com it searches every public project on the site, so the
        // precedent would be strangers' tickets. The search is scoped to the
        // user's most recently active projects instead, as github.ts does.
        const projects = (await loadProjects()).slice(0, SEARCH_PROJECTS);
        if (!projects.length) return [];
        const limit = Math.min(Math.max(opts?.limit ?? 10, 1), 50);
        const perProject = await Promise.all(
          projects.map((p) =>
            glJson<IssueRaw[]>(
              tok,
              `/projects/${p.id}/issues?search=${encodeURIComponent(q)}&per_page=${limit}&order_by=updated_at`,
            ).catch(() => [] as IssueRaw[]),
          ),
        );
        return perProject
          .flat()
          .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
          .slice(0, limit)
          .map((i) => {
            const identifier = refOf(i);
            const labels = i.labels ?? [];
            return {
              identifier,
              title: i.title,
              url: i.web_url,
              target: parseGitlabRef(identifier)?.path ?? "",
              state: liveStateName(i.state === "closed", labels),
              labels,
              assignee: i.assignees?.[0]?.name,
              priority: priorityOf(labels),
            };
          });
      } catch {
        return [];
      }
    },

    async getTargetDetails(targetId): Promise<TargetDetails> {
      const proj = projectRef(targetId);
      const want = targetId.trim().toLowerCase();
      const listed = await loadProjects().catch(() => [] as ProjectRaw[]);
      let project = listed.find((p) => String(p.id) === want || p.path_with_namespace.toLowerCase() === want);
      if (!project) {
        // Not in the listing (the agent may have passed a path): ask GitLab
        // directly. Only a 404 means "no such project"; an expired token or an
        // outage must surface as itself, not as a bad id.
        const r = await gl(tok, `/projects/${proj}`);
        if (r.ok) project = (await r.json()) as ProjectRaw;
        else if (r.status !== 404) throw await failure(tok, r, `/projects/${proj}`);
      }
      if (!project) {
        const known = listed.map((p) => `${p.path_with_namespace} (id: ${p.id})`).join(", ");
        throw new Error(`GitLab: "${targetId}" is not a project id. Known projects: ${known}`);
      }

      // By id from here on: it is how the project is known whatever was passed.
      const byId = projectRef(project.id);
      const [labels, members, milestones] = await Promise.all([
        projectLabels(byId),
        projectMembers(byId),
        projectMilestones(byId),
      ]);

      const customFields: NonNullable<TargetDetails["customFields"]> = [];
      if (milestones.length) {
        customFields.push({
          id: "milestone",
          name: "Milestone",
          type: "single-select",
          allowedValues: milestones.map((m) => m.title),
        });
      }
      customFields.push(
        { id: "due_date", name: "Due date", type: "date" },
        // Weight is a paid-tier field; a free project ignores it.
        { id: "weight", name: "Weight", type: "number" },
        { id: "confidential", name: "Confidential", type: "boolean" },
        { id: "issue_type", name: "Issue type", type: "single-select", allowedValues: ISSUE_TYPES },
      );

      return {
        id: String(project.id),
        key: project.path_with_namespace,
        name: project.name_with_namespace,
        description: toTarget(project).description,
        states: statesOf(labels),
        labels,
        members: members.map(memberLabel),
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
      const proj = projectRef(targetId);

      // Project uploads exist before the issue does, so the evidence can be
      // part of the body from the first save.
      const embeds: GitlabEmbed[] = [];
      // Counted on success only, so a failed upload leaves no gap in the names.
      let imgN = 0;
      let recN = 0;
      for (const e of evidence) {
        const kind = evidenceKind(e.contentType);
        const n = (kind === "image" ? imgN : recN) + 1;
        try {
          const form = new FormData();
          // GitLab puts the name in the link text and the URL, so it is the
          // neutral one, never the capture's own.
          form.append(
            "file",
            new Blob([new Uint8Array(e.bytes)], { type: e.contentType }),
            evidenceFileName(e.contentType, n),
          );
          const up = await glJson<UploadRaw>(tok, `/projects/${proj}/uploads`, { method: "POST", body: form });
          if (!up.markdown) continue;
          embeds.push({ kind, markdown: up.markdown, caption: e.caption });
          if (kind === "image") imgN = n;
          else recN = n;
        } catch (err) {
          // A missing screenshot must never cost the user the ticket.
          console.warn("[gitlab-tracker] evidence upload failed:", err instanceof Error ? err.message : err);
        }
      }

      const description = withBriefAttribution(
        withDetailsFolds(buildGitlabBody(descriptionMarkdown, embeds), details),
      );

      const wantsLabels = !!(labels?.length || priority || state?.trim());
      // Clearing (null or "") needs no lookup.
      const wantsMilestone = extraFields?.milestone != null && extraFields.milestone !== "";
      const [existing, members, milestones] = await Promise.all([
        wantsLabels ? projectLabels(proj) : Promise.resolve([] as string[]),
        assignee?.trim() ? projectMembers(proj) : Promise.resolve([] as MemberRaw[]),
        wantsMilestone ? projectMilestones(proj) : Promise.resolve([] as MilestoneRaw[]),
      ]);

      const norm = (s: string) => s.trim().toLowerCase();
      // Only labels the project already has: GitLab would silently create a
      // typo'd label and pollute the project's label set.
      let resolvedLabels = (labels ?? [])
        .map((want) => existing.find((l) => norm(l) === norm(want)) ?? resolveName(want, existing))
        .filter((l): l is string => !!l);

      // No priority field on GitLab: adopt the project's own label convention,
      // and drop any other priority of that family the agent also labelled.
      if (priority) {
        const plabel = gitlabPriorityLabel(priority, existing);
        if (plabel) {
          resolvedLabels = resolvedLabels.filter((l) => !samePriorityFamily(plabel, l));
          resolvedLabels.push(plabel);
        }
      }

      let closeAfter = false;
      if (state?.trim()) {
        const canonical = resolveName(state, statesOf(existing));
        if (canonical === "Closed") closeAfter = true;
        else if (canonical && canonical !== "Open") {
          // One status per scope: drop any other label the agent picked from it.
          const scope = labelScope(canonical);
          resolvedLabels = resolvedLabels.filter((l) => labelScope(l) !== scope);
          resolvedLabels.push(canonical);
        } else if (!canonical) {
          console.warn(`[gitlab-tracker] no state matched "${state}"`);
        }
      }
      resolvedLabels = Array.from(new Set(resolvedLabels));

      const member = assignee?.trim() ? resolveMember(assignee, members) : undefined;
      if (assignee?.trim() && !member) console.warn(`[gitlab-tracker] no member matched assignee "${assignee}"`);

      const { fields: extras } = gitlabExtraFields(extraFields, milestones, false);
      const base: Record<string, unknown> = {
        title,
        description,
        ...(resolvedLabels.length ? { labels: resolvedLabels.join(",") } : {}),
      };
      const full: Record<string, unknown> = {
        ...extras,
        ...base,
        ...(member ? { assignee_ids: [member.id] } : {}),
      };

      const create = (fields: Record<string, unknown>) =>
        gl(tok, `/projects/${proj}/issues`, { method: "POST", body: JSON.stringify(fields) });
      let res = await create(full);
      if (res.status === 400 && Object.keys(full).length > Object.keys(base).length) {
        // A field this project refuses must not cost the user the ticket.
        // Retry with only what was resolved against the project itself.
        console.warn(`[gitlab-tracker] create with extras rejected (400) - retrying without: ${redact(tok, (await res.text()).slice(0, 300))}`);
        res = await create(base);
      }
      if (!res.ok) throw await failure(tok, res, `/projects/${proj}/issues`);
      const created = (await res.json()) as IssueRaw;

      // GitLab cannot create an issue closed, so closing is its own call.
      if (closeAfter) {
        try {
          const r = await gl(tok, `/projects/${proj}/issues/${created.iid}`, {
            method: "PUT",
            body: JSON.stringify({ state_event: "close" }),
          });
          if (!r.ok) console.warn(`[gitlab-tracker] close after create failed: ${r.status}`);
        } catch (err) {
          console.warn("[gitlab-tracker] close after create failed:", err instanceof Error ? err.message : err);
        }
      }

      if (comment?.trim()) {
        try {
          const r = await gl(tok, `/projects/${proj}/issues/${created.iid}/notes`, {
            method: "POST",
            body: JSON.stringify({ body: comment.trim() }),
          });
          if (!r.ok) console.warn(`[gitlab-tracker] comment post failed: ${r.status}`);
        } catch (err) {
          console.warn("[gitlab-tracker] comment post failed:", err instanceof Error ? err.message : err);
        }
      }

      return {
        id: String(created.id),
        identifier: refOf(created),
        url: created.web_url,
        title: created.title ?? title,
      };
    },

    async updateIssue(identifier, patch: IssuePatch): Promise<UpdateResult> {
      const ref = parseGitlabRef(identifier);
      if (!ref) return { ok: false, error: `"${identifier}" is not a GitLab issue ref (expected group/project#12)` };
      const proj = projectRef(ref.path);
      const issuePath = `/projects/${proj}/issues/${ref.iid}`;
      try {
        const state = patch.state?.trim();
        const needLabels = !!(patch.labels?.length || state || patch.priority);
        const [issue, existing, members, milestones] = await Promise.all([
          state || patch.priority ? glJson<IssueRaw>(tok, issuePath) : Promise.resolve(null),
          needLabels ? projectLabels(proj, true) : Promise.resolve([] as string[]),
          patch.assignee?.trim() ? projectMembers(proj, true) : Promise.resolve([] as MemberRaw[]),
          patch.extraFields?.milestone != null && patch.extraFields.milestone !== ""
            ? projectMilestones(proj, true)
            : Promise.resolve([] as MilestoneRaw[]),
        ]);
        const current = issue?.labels ?? [];

        // Everything is resolved and checked before anything is sent, so a
        // bad value leaves the issue untouched rather than half-updated.
        const extra = gitlabExtraFields(patch.extraFields, milestones, true);
        if (extra.error) return { ok: false, error: extra.error };
        const fields: Record<string, unknown> = { ...extra.fields };
        const add = new Set<string>();
        const remove = new Set<string>();

        if (patch.title?.trim()) fields.title = patch.title.trim();

        if (patch.labels?.length) {
          const missing: string[] = [];
          for (const want of patch.labels) {
            const hit = resolveName(want, existing);
            if (hit) add.add(hit);
            else missing.push(want);
          }
          if (missing.length) {
            const which = missing.map((m) => `"${m}"`).join(", ");
            return {
              ok: false,
              error: `Unknown label${missing.length > 1 ? "s" : ""} ${which}. Valid: ${existing.join(", ") || "(none)"}`,
            };
          }
        }

        if (state) {
          const states = statesOf(existing);
          const canonical = resolveName(state, states);
          if (!canonical) return { ok: false, error: `Unknown state "${state}". Valid: ${states.join(", ")}` };
          if (canonical === "Closed") fields.state_event = "close";
          else if (canonical === "Open") fields.state_event = "reopen";
          else {
            // A scoped label is exclusive on paid tiers only; on a free
            // project both would stay, so the old status is removed explicitly.
            const scope = labelScope(canonical);
            const sameScope = (l: string) => l !== canonical && labelScope(l) === scope;
            for (const l of [...add]) if (sameScope(l)) add.delete(l);
            add.add(canonical);
            for (const l of current) if (sameScope(l)) remove.add(l);
            // A closed issue labelled "In review" would read In review on the
            // issue and Closed in the feed; a status means it is open again.
            if (issue?.state === "closed") fields.state_event = "reopen";
          }
        }

        if (patch.priority) {
          const plabel = gitlabPriorityLabel(patch.priority, existing);
          if (!plabel) {
            return {
              ok: false,
              error: `No label on this project expresses priority "${patch.priority}". Labels: ${existing.join(", ") || "(none)"}`,
            };
          }
          for (const l of [...add]) if (samePriorityFamily(plabel, l)) add.delete(l);
          add.add(plabel);
          for (const l of current) if (samePriorityFamily(plabel, l)) remove.add(l);
        }

        if (patch.assignee?.trim()) {
          const m = resolveMember(patch.assignee, members);
          if (!m) {
            return {
              ok: false,
              error: `Unknown assignee "${patch.assignee}". Valid: ${members.map(memberLabel).join(", ") || "(none)"}`,
            };
          }
          fields.assignee_ids = [m.id];
        }

        for (const l of add) remove.delete(l);
        if (add.size) fields.add_labels = [...add].join(",");
        if (remove.size) fields.remove_labels = [...remove].join(",");

        if (!Object.keys(fields).length) return { ok: false, error: "nothing to update" };
        const r = await gl(tok, issuePath, { method: "PUT", body: JSON.stringify(fields) });
        if (!r.ok) return { ok: false, error: (await failure(tok, r, issuePath)).message };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    async getIssue(identifier) {
      const ref = parseGitlabRef(identifier);
      if (!ref) throw new Error(`"${identifier}" is not a GitLab issue ref (expected group/project#12)`);
      const i = await glJson<IssueRaw>(tok, `/projects/${projectRef(ref.path)}/issues/${ref.iid}`);
      const labels = i.labels ?? [];
      return {
        identifier: refOf(i),
        title: i.title,
        // The full status label, so the agent's verify step compares it with
        // the same value it picked from the target's state list.
        state: i.state === "closed" ? "Closed" : (statusLabels(labels)[0] ?? "Open"),
        labels,
        assignees: (i.assignees ?? []).map((a) => `${a.name} (@${a.username})`),
        milestone: i.milestone?.title ?? null,
        url: i.web_url,
        priority: priorityOf(labels) ?? null,
        due_date: i.due_date ?? null,
        weight: i.weight ?? null,
        confidential: i.confidential ?? false,
        issue_type: i.issue_type ?? null,
      };
    },

    async getLiveIssues(identifiers): Promise<LiveIssueLookup> {
      const issues: Record<string, LiveIssue> = {};
      const gone: string[] = [];

      const byProject = new Map<string, Array<{ id: string; iid: number }>>();
      for (const id of new Set(identifiers.filter(Boolean))) {
        const ref = parseGitlabRef(id);
        if (!ref) continue;
        const list = byProject.get(ref.path) ?? [];
        list.push({ id, iid: ref.iid });
        byProject.set(ref.path, list);
      }

      // One list call per project instead of one call per issue.
      async function readProject(path: string, refs: Array<{ id: string; iid: number }>) {
        const proj = projectRef(path);
        const found = new Set<number>();
        for (const batch of chunk(refs, 50)) {
          const iids = batch.map((r) => `iids[]=${r.iid}`).join("&");
          const r = await gl(tok, `/projects/${proj}/issues?${iids}&per_page=100`);
          // An unreachable project (deleted, renamed away, access revoked, or
          // GitLab down) says nothing about its issues: leave them alone.
          if (!r.ok) return;
          for (const issue of (await r.json()) as IssueRaw[]) {
            const hit = batch.find((x) => x.iid === issue.iid);
            if (!hit) continue;
            found.add(issue.iid);
            issues[hit.id] = liveIssue(issue);
          }
        }

        const missing = refs.filter((r) => !found.has(r.iid));
        if (!missing.length) return;
        // A list can omit an issue that still exists (a type the list filters
        // out, say), so absence is only a hint. It counts as deleted only when
        // the project answers and the issue itself is a 404.
        const p = await gl(tok, `/projects/${proj}`);
        if (p.status !== 200) return;
        for (const m of missing) {
          const r = await gl(tok, `/projects/${proj}/issues/${m.iid}`);
          if (r.status === 404) gone.push(m.id);
          else if (r.ok) issues[m.id] = liveIssue((await r.json()) as IssueRaw);
        }
      }

      await Promise.all(
        [...byProject].map(([path, refs]) =>
          readProject(path, refs).catch((err) => {
            console.warn("[gitlab-tracker] live read failed:", err instanceof Error ? err.message : err);
          }),
        ),
      );
      return { issues, gone };
    },
  };
}

/**
 * The top-level groups this token belongs to, for the workspace picker.
 *
 * `min_access_level` is what makes this a membership list: without it,
 * gitlab.com answers with every public group on the site. Top-level only,
 * because the group is the company identity and subgroups are its teams.
 */
export async function listGitlabGroups(tok: GitlabTok): Promise<Workspace[]> {
  try {
    const groups = await glJson<Array<{ id: number; full_name: string; avatar_url?: string | null }>>(
      tok,
      "/groups?min_access_level=10&top_level_only=true&per_page=100",
    );
    return groups.map((g) => ({
      id: String(g.id),
      name: g.full_name,
      avatarUrl: g.avatar_url ?? undefined,
    }));
  } catch {
    return [];
  }
}
