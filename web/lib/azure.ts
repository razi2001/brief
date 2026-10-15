import {
  BRIEF_ATTRIBUTION,
  NO_CAPABILITIES,
  STATUS_COLOR,
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
import { chunk } from "./ticket-sync";
import { mdToHtml } from "./md-html";
import {
  evidenceExtension,
  evidenceKind,
  evidenceLabel,
  promoteSectionHeadings,
  splitAtEvidenceEnd,
} from "./ticket-body";

/**
 * Azure DevOps is reached two ways: Brief's own Entra ID OAuth in production
 * ("Bearer <token>") and a Personal Access Token in the live test, which Azure
 * DevOps only accepts as HTTP Basic ("Basic base64(:pat)"). The adapter takes
 * the finished header value so it never has to know which one it was given.
 *
 * The organization is not in either token: it is picked once (see
 * listAzureOrgs) and carried here, because every API host is per organization.
 */
export type AzureTok = { org: string; authorization: string };

const API_VERSION = "7.1";
/** Work item comments are still a preview API in 7.1; plain "7.1" is refused. */
const COMMENTS_API_VERSION = "7.1-preview.4";

/** The organization-independent host that answers "who am I, and where am I a member". */
const VSSPS = "https://app.vssps.visualstudio.com";

const AUTH_EXPIRED =
  "Your Azure DevOps connection has expired - reconnect Azure DevOps under Settings, then retry.";

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/**
 * Azure DevOps work-item fields we set by name. These are reference names, not
 * display names: a project can rename "Priority" in its process template and
 * the reference name stays put.
 */
export const AZ_FIELD = {
  title: "System.Title",
  description: "System.Description",
  /** Bugs keep their body HERE, not in System.Description. See bodyField(). */
  reproSteps: "Microsoft.VSTS.TCM.ReproSteps",
  state: "System.State",
  assignedTo: "System.AssignedTo",
  tags: "System.Tags",
  areaPath: "System.AreaPath",
  priority: "Microsoft.VSTS.Common.Priority",
} as const;

/**
 * Which field carries the ticket body for a given work item type.
 *
 * This is the single most consequential detail in the whole adapter. The Bug
 * work item in every stock Azure DevOps process (Agile, Scrum, CMMI) does not
 * show System.Description on its form at all - it shows Repro Steps. Writing a
 * bug's body into System.Description produces a work item that looks completely
 * empty to the team that has to fix it, while the text sits in a field nobody
 * has on screen.
 */
export function bodyField(workItemType: string): string {
  return /bug/i.test(workItemType) ? AZ_FIELD.reproSteps : AZ_FIELD.description;
}

/** Azure DevOps priority is 1 (highest) to 4 (lowest). */
const AZ_PRIORITY: Record<TrackerPriority, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

export function priorityName(value: unknown): string | null {
  const n = Number(value);
  const hit = (Object.entries(AZ_PRIORITY) as Array<[TrackerPriority, number]>).find(
    ([, v]) => v === n,
  );
  return hit ? hit[0] : null;
}

/** Map an Azure DevOps state category to one of our brand status colors. */
export function azureStateColor(category?: string, state?: string): string {
  const c = (category ?? "").toLowerCase();
  if (c === "completed" || c === "resolved") return STATUS_COLOR.done;
  if (c === "inprogress" || c === "in progress") return STATUS_COLOR.active;
  if (c === "proposed") return STATUS_COLOR.neutral;
  // No category (older APIs): fall back to the well-known stock state names.
  const s = (state ?? "").toLowerCase();
  if (["done", "closed", "resolved", "completed"].includes(s)) return STATUS_COLOR.done;
  if (["active", "committed", "in progress", "doing"].includes(s)) return STATUS_COLOR.active;
  return STATUS_COLOR.neutral;
}

// ---------------------------------------------------------------------------
// JSON Patch
// ---------------------------------------------------------------------------

export type PatchOp = {
  op: "add" | "replace" | "remove" | "test";
  path: string;
  value?: unknown;
};

/**
 * One `add` op per field, which is how Azure DevOps expects a create or an
 * update. `add` rather than `replace` on updates too: `replace` is only legal
 * for a field that already has a value, and an unassigned work item has no
 * System.AssignedTo to replace.
 */
export function fieldOps(fields: Record<string, unknown>): PatchOp[] {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([path, value]) => ({ op: "add" as const, path: `/fields/${path}`, value }));
}

/** Azure DevOps stores tags as one semicolon-separated string, not a list. */
export function tagsValue(tags: string[]): string {
  return tags.map((t) => t.trim()).filter(Boolean).join("; ");
}

export function parseTags(value: unknown): string[] {
  return String(value ?? "")
    .split(";")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** The relation op that puts an uploaded file in the Attachments panel. */
export function attachmentOp(url: string, comment?: string): PatchOp {
  return {
    op: "add",
    path: "/relations/-",
    value: {
      rel: "AttachedFile",
      url,
      attributes: comment ? { comment } : {},
    },
  };
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/**
 * Work item ids are unique across the whole organization, so the number alone
 * is enough to address one. The project is carried along for display and to
 * build the browse url, in the "AB#1234" spirit of Azure Boards references.
 * A project name cannot contain "#", so the split is unambiguous.
 */
export function parseWorkItemRef(identifier: string): { project?: string; id: number } | null {
  const s = (identifier ?? "").trim();
  const withProject = /^(.+)#(\d+)$/.exec(s);
  if (withProject) return { project: withProject[1], id: Number(withProject[2]) };
  const bare = /^#?(\d+)$/.exec(s);
  return bare ? { id: Number(bare[1]) } : null;
}

export function workItemUrl(org: string, project: string, id: number): string {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_workitems/edit/${id}`;
}

// ---------------------------------------------------------------------------
// Evidence and body
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The name an evidence file is uploaded under.
 *
 * Azure DevOps shows it in the Attachments panel AND bakes it into the
 * attachment url (".../attachments/<guid>?fileName=..."), which is also the
 * inline image's src. Brief's own names ("replay.webm", "replay-frames/...")
 * say how the report was captured, which a ticket must never do, so every file
 * goes up under its plain label: "Screenshot 2.png", "Screen recording.webm",
 * the same words as the inline image's alt text in the body.
 */
export function neutralFileName(contentType: string, index: number): string {
  return `${evidenceLabel(contentType, index)}.${evidenceExtension(contentType)}`;
}

/** The attribution, as the HTML the work item body field stores. */
const ATTRIBUTION_HTML = `<hr />\n${mdToHtml(BRIEF_ATTRIBUTION)}`;

/**
 * Drop an attribution the markdown already carries (a re-filed, already
 * written ticket), so the HTML version is appended exactly once, at the end.
 */
function withoutAttribution(markdown: string): string {
  const t = (markdown ?? "").replace(/\s+$/, "");
  if (!t.endsWith(BRIEF_ATTRIBUTION)) return t;
  return t
    .slice(0, -BRIEF_ATTRIBUTION.length)
    .replace(/\s+$/, "")
    .replace(/(^|\n)[ \t]*-{3,}$/, "")
    .replace(/\s+$/, "");
}

/** One uploaded evidence file, as the body sees it. */
export type AzureEvidence = { url: string; isImage: boolean; caption?: string };

/**
 * Build the work item body as HTML: the agent's markdown, the evidence, the
 * technical logs, then the attribution - always last, under its divider.
 *
 * Azure DevOps body fields are HTML, and an uploaded attachment url renders
 * inline in them, so screenshots are shown in place (they also sit in the
 * Attachments panel, via the relation ops). The rules match GitHub's body:
 *
 *  - Evidence goes at the end of the agent's own Evidence section when it
 *    wrote one, else under a new heading. Never two.
 *  - Each image's caption sits directly above it.
 *  - A recording is only ever "Screen recording": no file names, nothing about
 *    how the report was captured.
 */
export function buildAzureBody(
  descriptionMarkdown: string,
  evidence: AzureEvidence[],
  details?: Array<{ title: string; markdown: string }>,
): string {
  const md = withoutAttribution(promoteSectionHeadings(descriptionMarkdown ?? ""));

  const parts: string[] = [];
  let imgN = 0;
  for (const e of evidence) {
    const url = escapeHtml(e.url);
    if (e.isImage) {
      imgN += 1;
      const cap = e.caption?.trim() ? `<p>${escapeHtml(e.caption.trim())}</p>\n` : "";
      parts.push(`${cap}<p><img src="${url}" alt="Screenshot ${imgN}" /></p>`);
    } else {
      parts.push(
        `<p><strong>Screen recording:</strong> <a href="${url}">Watch the screen recording</a></p>`,
      );
    }
  }

  const blocks: string[] = [];
  if (!parts.length) {
    blocks.push(mdToHtml(md));
  } else {
    // The evidence is HTML by now, so the markdown is split around it rather
    // than handed to placeEvidence. Same section rule either way.
    const split = splitAtEvidenceEnd(md);
    if (split) {
      // Reuse the agent's own heading rather than adding a competing one.
      blocks.push(mdToHtml(split.head), ...parts, mdToHtml(split.tail));
    } else {
      // "## Evidence" in the agent's markdown would render as <h3>, so a new
      // heading matches the level the agent's own would have had.
      blocks.push(mdToHtml(md), "<h3>Evidence</h3>", ...parts);
    }
  }

  // Each video's technical logs under their own title. These are exact data,
  // never the agent's words, so they come after everything the agent wrote.
  for (const d of details ?? []) {
    if (!d.markdown.trim()) continue;
    blocks.push(`<h3>${escapeHtml(d.title)}</h3>`, mdToHtml(d.markdown.trim()));
  }

  blocks.push(ATTRIBUTION_HTML);
  return blocks.filter((b) => b.trim()).join("\n");
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function azBase(org: string): string {
  return `https://dev.azure.com/${encodeURIComponent(org)}`;
}

async function az(
  tok: AzureTok,
  path: string,
  init: RequestInit = {},
  apiVersion: string = API_VERSION,
): Promise<Response> {
  const headers = new Headers(init.headers);
  // Verbatim: "Bearer ..." for Entra ID, "Basic ..." for a PAT.
  headers.set("Authorization", tok.authorization);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${azBase(tok.org)}${path}${sep}api-version=${apiVersion}`, {
    ...init,
    headers,
  });
  // A rejected PAT does not get a 401: Azure DevOps answers 203 with its HTML
  // sign-in page, which would otherwise fail later as unparseable JSON.
  if (r.status === 401 || r.status === 203) throw new Error(AUTH_EXPIRED);
  return r;
}

async function azJson<T>(
  tok: AzureTok,
  path: string,
  init: RequestInit = {},
  apiVersion?: string,
): Promise<T> {
  const r = await az(tok, path, init, apiVersion);
  if (!r.ok) throw new Error(`Azure DevOps ${path} failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

/**
 * The organizations this token can see, for the workspace pick.
 *
 * Azure DevOps has no "my organizations" call. The accounts list needs the
 * caller's member id, which only the profile service knows, so this is two
 * calls against the organization-independent vssps host. A PAT scoped to one
 * organization is not allowed to list accounts at all; that, like any other
 * failure, reads as an empty list rather than an error.
 */
export async function listAzureOrgs(authorization: string): Promise<Workspace[]> {
  const get = async <T>(path: string): Promise<T | null> => {
    const r = await fetch(`${VSSPS}${path}`, {
      headers: { Authorization: authorization, Accept: "application/json" },
    });
    // 203 is the sign-in page a rejected PAT gets instead of a 401.
    if (!r.ok || r.status === 203) return null;
    return (await r.json()) as T;
  };
  try {
    const me = await get<{ id?: string }>(`/_apis/profile/profiles/me?api-version=${API_VERSION}`);
    if (!me?.id) return [];
    const accounts = await get<{ value?: Array<{ accountName?: string }> } | Array<{ accountName?: string }>>(
      `/_apis/accounts?memberId=${encodeURIComponent(me.id)}&api-version=${API_VERSION}`,
    );
    // Documented as Account[], served as { count, value }: accept either.
    const list = Array.isArray(accounts) ? accounts : (accounts?.value ?? []);
    const names = Array.from(
      new Set(list.map((a) => a.accountName).filter((n): n is string => !!n)),
    );
    return names.sort((a, b) => a.localeCompare(b)).map((n) => ({ id: n, name: n }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tracker implementation
// ---------------------------------------------------------------------------

type WorkItem = {
  id: number;
  fields?: Record<string, unknown>;
  url?: string;
};

function fieldStr(wi: WorkItem, name: string): string {
  const v = wi.fields?.[name];
  if (v && typeof v === "object" && "displayName" in (v as object)) {
    return String((v as { displayName?: string }).displayName ?? "");
  }
  return v == null ? "" : String(v);
}

/**
 * A batch read under errorPolicy=Omit answers a missing work item with a null
 * entry in `value`, not a 404. Those nulls must be dropped before anything
 * reads `.id`, or one deleted ticket throws away the whole batch.
 */
function presentItems(value: Array<WorkItem | null> | undefined): WorkItem[] {
  return (value ?? []).filter((wi): wi is WorkItem => !!wi && typeof wi.id === "number");
}

export function makeAzureTracker(tok: AzureTok): Tracker {
  let projectsCache: TrackerTarget[] | null = null;

  async function loadProjects(): Promise<TrackerTarget[]> {
    if (projectsCache) return projectsCache;
    const j = await azJson<{ value?: Array<{ id: string; name: string; description?: string }> }>(
      tok,
      `/_apis/projects?$top=200`,
    );
    projectsCache = (j.value ?? []).map((p) => ({
      id: p.name,
      key: p.name,
      name: p.name,
      description: p.description || undefined,
    }));
    return projectsCache;
  }

  async function workItemTypes(project: string): Promise<string[]> {
    try {
      const j = await azJson<{ value?: Array<{ name: string; isDisabled?: boolean }> }>(
        tok,
        `/${encodeURIComponent(project)}/_apis/wit/workitemtypes`,
      );
      return (j.value ?? []).filter((t) => !t.isDisabled).map((t) => t.name);
    } catch {
      return [];
    }
  }

  /**
   * The project's types plus the default one: Bug (this is a bug reporter),
   * then Issue/Task, else whatever exists. One read serves both, since callers
   * need the list too.
   */
  async function typesAndDefault(project: string): Promise<{ types: string[]; type: string }> {
    const types = await workItemTypes(project);
    if (!types.length) throw new Error(`Azure DevOps: project ${project} has no work item types.`);
    const by = (n: string) => types.find((t) => t.toLowerCase() === n);
    return { types, type: by("bug") ?? by("issue") ?? by("task") ?? types[0] };
  }

  /**
   * Who System.AssignedTo will actually accept: the members of the project's
   * teams. Read in parallel, since a project with many teams would otherwise
   * cost one round trip each.
   */
  async function projectMembers(project: string): Promise<string[]> {
    const teams = await azJson<{ value?: Array<{ name: string }> }>(
      tok,
      `/_apis/projects/${encodeURIComponent(project)}/teams`,
    ).catch(() => ({ value: [] as Array<{ name: string }> }));
    const rosters = await Promise.all(
      (teams.value ?? []).slice(0, 20).map((t) =>
        azJson<{ value?: Array<{ identity?: { displayName?: string } }> }>(
          tok,
          `/_apis/projects/${encodeURIComponent(project)}/teams/${encodeURIComponent(t.name)}/members`,
        ).catch(() => ({ value: [] })),
      ),
    );
    const members: string[] = [];
    for (const m of rosters) {
      for (const x of m.value ?? []) {
        const dn = x.identity?.displayName;
        if (dn && !members.includes(dn)) members.push(dn);
      }
    }
    return members;
  }

  /**
   * Every area path two levels deep, root included, in the backslash form
   * System.AreaPath takes ("Project\\Billing\\Invoices").
   */
  async function areaPaths(project: string): Promise<string[]> {
    type Node = { name: string; children?: Node[] };
    const root = await azJson<Node>(
      tok,
      `/${encodeURIComponent(project)}/_apis/wit/classificationnodes/areas?$depth=2`,
    ).catch(() => null);
    const out = [project];
    const walk = (nodes: Node[] | undefined, prefix: string) => {
      for (const n of nodes ?? []) {
        const path = `${prefix}\\${n.name}`;
        out.push(path);
        walk(n.children, path);
      }
    };
    walk(root?.children, project);
    return out;
  }

  /**
   * Which of these ids Azure DevOps confirms are deleted.
   *
   * A batch read under errorPolicy=Omit nulls a deleted work item AND one the
   * caller may no longer read, so an omission alone can't tell a ticket that
   * is gone from one the user lost access to. The recycle bin can: an id only
   * comes back from it (with a deletion date) when it really was deleted. Any
   * failure confirms nothing.
   */
  async function confirmedDeleted(ids: number[]): Promise<Set<number>> {
    type Ref = { id?: number | string; code?: number; deletedDate?: string };
    try {
      const j = await azJson<{ value?: Ref[] } | Ref[]>(tok, `/_apis/wit/recyclebin?ids=${ids.join(",")}`);
      // Documented as a bare array, served elsewhere as { count, value }.
      const refs = Array.isArray(j) ? j : (j.value ?? []);
      return new Set(
        refs
          .filter((r) => (r.code === undefined || r.code === 200) && !!r.deletedDate)
          .map((r) => Number(r.id))
          .filter((n) => ids.includes(n)),
      );
    } catch {
      return new Set();
    }
  }

  async function statesFor(project: string, type: string): Promise<string[]> {
    try {
      const j = await azJson<{ value?: Array<{ name: string }> }>(
        tok,
        `/${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states`,
      );
      return (j.value ?? []).map((s) => s.name);
    } catch {
      return [];
    }
  }

  async function upload(
    project: string,
    fileName: string,
    bytes: Buffer,
  ): Promise<string | null> {
    try {
      const r = await az(
        tok,
        `/${encodeURIComponent(project)}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}&uploadType=Simple`,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: new Uint8Array(bytes),
        },
      );
      if (!r.ok) return null;
      const j = (await r.json()) as { url?: string };
      return j.url ?? null;
    } catch {
      return null;
    }
  }

  async function readWorkItem(id: number): Promise<WorkItem> {
    return azJson<WorkItem>(tok, `/_apis/wit/workitems/${id}?$expand=none`);
  }

  return {
    kind: "azure",
    targetNoun: "project",
    capabilities: {
      ...NO_CAPABILITIES,
      states: true,
      priority: true,
      labels: true,
      customFields: true,
      issueTypes: true,
      comments: true,
      nativeAttachments: true,
      // Area path is Azure DevOps' second axis inside a project.
      projects: true,
    },
    bodyGuidance:
      "The description is converted to HTML for the work item. On a Bug it lands in the Repro Steps field (which is what the Bug form actually shows), and on any other work item type in Description. Section labels you write on their own line become real headings. Screenshots are embedded inline. Tags stand in for labels.",

    async listTargets() {
      return loadProjects();
    },

    async searchIssues(query, opts): Promise<IssueSearchResult[]> {
      const q = query.trim();
      if (!q) return [];
      try {
        const limit = Math.min(Math.max(opts?.limit ?? 15, 1), 50);
        // WIQL is the only cross-project query language Azure DevOps exposes
        // without the (separately licensed) Search extension.
        const safe = q.replace(/'/g, "''");
        const wiql = {
          query:
            `SELECT [System.Id] FROM WorkItems ` +
            `WHERE [System.Title] CONTAINS '${safe}' ` +
            `ORDER BY [System.ChangedDate] DESC`,
        };
        // $top keeps the server from materializing up to 20,000 matches for a
        // common word when we only ever read the first few.
        const res = await azJson<{ workItems?: Array<{ id: number }> }>(
          tok,
          `/_apis/wit/wiql?$top=${limit}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(wiql),
          },
        );
        const ids = (res.workItems ?? []).slice(0, limit).map((w) => w.id);
        if (!ids.length) return [];

        const fields = [
          "System.Id",
          AZ_FIELD.title,
          AZ_FIELD.state,
          AZ_FIELD.tags,
          AZ_FIELD.assignedTo,
          AZ_FIELD.priority,
          AZ_FIELD.areaPath,
          "System.TeamProject",
          "System.WorkItemType",
        ].join(",");
        const batch = await azJson<{ value?: Array<WorkItem | null> }>(
          tok,
          `/_apis/wit/workitems?ids=${ids.join(",")}&fields=${encodeURIComponent(fields)}&errorPolicy=Omit`,
        );
        return presentItems(batch.value).map((wi) => {
          const project = fieldStr(wi, "System.TeamProject");
          return {
            identifier: `${project}#${wi.id}`,
            title: fieldStr(wi, AZ_FIELD.title),
            url: workItemUrl(tok.org, project, wi.id),
            target: project,
            state: fieldStr(wi, AZ_FIELD.state) || undefined,
            labels: parseTags(wi.fields?.[AZ_FIELD.tags]),
            assignee: fieldStr(wi, AZ_FIELD.assignedTo) || undefined,
            priority: priorityName(wi.fields?.[AZ_FIELD.priority]) ?? undefined,
            issueType: fieldStr(wi, "System.WorkItemType") || undefined,
            project: fieldStr(wi, AZ_FIELD.areaPath) || undefined,
          };
        });
      } catch {
        return [];
      }
    },

    async getTargetDetails(targetId): Promise<TargetDetails> {
      const projects = await loadProjects();
      const project = projects.find((p) => p.id === targetId || p.name === targetId);
      if (!project) {
        throw new Error(
          `Azure DevOps: project ${targetId} not found. Known projects: ${projects.map((p) => p.name).join(", ")}`,
        );
      }
      const name = project.name;
      const { types, type } = await typesAndDefault(name);
      const [states, fieldsRaw, members, areas] = await Promise.all([
        statesFor(name, type),
        azJson<{
          value?: Array<{
            referenceName: string;
            name: string;
            alwaysRequired?: boolean;
            allowedValues?: string[];
            type?: string;
          }>;
        }>(
          tok,
          `/${encodeURIComponent(name)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/fields?$expand=allowedValues`,
        ).catch(() => ({ value: [] })),
        projectMembers(name),
        areaPaths(name),
      ]);

      // Fields the agent can meaningfully set, minus the ones already reachable
      // through a first-class parameter.
      const handled = new Set<string>(Object.values(AZ_FIELD));
      const customFields = (fieldsRaw.value ?? [])
        .filter((f) => !handled.has(f.referenceName))
        .filter((f) => (f.allowedValues?.length ?? 0) > 0 || f.alwaysRequired)
        .slice(0, 40)
        .map((f) => ({
          id: f.referenceName,
          name: f.name,
          type: f.type ?? "string",
          required: f.alwaysRequired,
          allowedValues: f.allowedValues?.length ? f.allowedValues : undefined,
        }));

      return {
        id: name,
        key: name,
        name,
        description: project.description,
        states,
        // Tags are Azure DevOps' labels, and unlike Linear/GitHub they are
        // free-form: there is no list to choose from until one has been used.
        labels: [],
        members,
        projects: areas.map((a) => ({ id: a, name: a })),
        issueTypes: types,
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
      project,
      comment,
      extraFields,
      evidence,
      details,
    }) {
      const projects = await loadProjects();
      const target = projects.find((p) => p.id === targetId || p.name === targetId);
      const projectName = target?.name ?? targetId;

      const wantType = (extraFields ?? {})["System.WorkItemType"];
      const known = await typesAndDefault(projectName);
      const type =
        (typeof wantType === "string" && wantType.trim() ? resolveName(wantType, known.types) : undefined) ??
        known.type;

      // Upload first: an inline <img> can only reference a url that exists.
      // Numbered by what actually uploaded, so a failed file leaves no gap
      // between "Screenshot 1" and "Screenshot 3".
      const uploaded: Array<AzureEvidence> = [];
      let images = 0;
      let recordings = 0;
      for (const e of evidence) {
        const isImage = evidenceKind(e.contentType) === "image";
        const name = neutralFileName(e.contentType, (isImage ? images : recordings) + 1);
        const url = await upload(projectName, name, e.bytes);
        if (!url) {
          console.warn(`[azure-tracker] evidence upload failed: ${name}`);
          continue;
        }
        if (isImage) images += 1;
        else recordings += 1;
        uploaded.push({ url, isImage, caption: e.caption });
      }

      const body = buildAzureBody(descriptionMarkdown, uploaded, details);

      const base = fieldOps({
        [AZ_FIELD.title]: title,
        [bodyField(type)]: body,
      });
      const relations = uploaded.map((u) => attachmentOp(u.url, u.caption));

      // The fields Brief resolved from the agent's first-class parameters.
      const resolved = fieldOps({
        ...(labels?.length ? { [AZ_FIELD.tags]: tagsValue(labels) } : {}),
        ...(priority ? { [AZ_FIELD.priority]: AZ_PRIORITY[priority] } : {}),
        ...(assignee ? { [AZ_FIELD.assignedTo]: assignee } : {}),
        ...(project ? { [AZ_FIELD.areaPath]: project } : {}),
      });
      // The agent's raw fields by reference name. Base and resolved fields win
      // over a raw field naming the same path, as on Jira.
      const taken = new Set([...base, ...resolved].map((o) => o.path));
      const passthrough = fieldOps(
        Object.fromEntries(
          Object.entries(extraFields ?? {}).filter(([k]) => k !== "System.WorkItemType"),
        ),
      ).filter((o) => !taken.has(o.path));

      const create = (ops: PatchOp[]) =>
        az(tok, `/${encodeURIComponent(projectName)}/_apis/wit/workitems/$${encodeURIComponent(type)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json-patch+json" },
          body: JSON.stringify(ops),
        });

      // Any one field can reject the WHOLE create with a 400 (an ambiguous
      // assignee name, an area path that doesn't exist, a type with no
      // Priority field), so the create retries in stages. First without the
      // resolved fields only: the raw fields stay, because they are where a
      // project's REQUIRED custom fields come from, and without those every
      // create fails. Only then without anything optional. The agent's verify
      // loop repairs whatever was dropped.
      const attempts: PatchOp[][] = [[...base, ...passthrough, ...resolved, ...relations]];
      if (resolved.length) attempts.push([...base, ...passthrough, ...relations]);
      if (passthrough.length) attempts.push([...base, ...relations]);

      let res = await create(attempts[0]);
      for (const next of attempts.slice(1)) {
        if (res.ok || res.status !== 400) break;
        console.warn(`[azure-tracker] create rejected (400) - retrying with fewer fields: ${await res.text()}`);
        res = await create(next);
      }
      if (!res.ok) {
        throw new Error(`Azure DevOps work item create failed: ${res.status} ${await res.text()}`);
      }
      const created = (await res.json()) as WorkItem;

      // State is set AFTER the create, not in it. A state the type doesn't have
      // rejects the whole create, and so can a valid state that isn't an
      // initial one. Resolved against the type's real list, then best-effort.
      if (state) {
        try {
          const valid = await statesFor(projectName, type);
          const canonical = resolveName(state, valid);
          if (!canonical) {
            console.warn(`[azure-tracker] no state matched "${state}" (valid: ${valid.join(", ")})`);
          } else if (canonical !== fieldStr(created, AZ_FIELD.state)) {
            const r = await az(tok, `/_apis/wit/workitems/${created.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json-patch+json" },
              body: JSON.stringify(fieldOps({ [AZ_FIELD.state]: canonical })),
            });
            if (!r.ok) console.warn(`[azure-tracker] state "${canonical}" not set: ${r.status}`);
          }
        } catch (err) {
          console.warn("[azure-tracker] state update failed:", err);
        }
      }

      if (comment?.trim()) {
        try {
          await azJson(
            tok,
            `/${encodeURIComponent(projectName)}/_apis/wit/workItems/${created.id}/comments`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              // Comment text is HTML, like the body fields.
              body: JSON.stringify({ text: mdToHtml(comment.trim()) }),
            },
            COMMENTS_API_VERSION,
          );
        } catch (err) {
          console.warn("[azure-tracker] comment post failed:", err);
        }
      }

      return {
        id: String(created.id),
        identifier: `${projectName}#${created.id}`,
        url: workItemUrl(tok.org, projectName, created.id),
        title: fieldStr(created, AZ_FIELD.title) || title,
      };
    },

    async updateIssue(identifier, patch: IssuePatch): Promise<UpdateResult> {
      const ref = parseWorkItemRef(identifier);
      if (!ref) return { ok: false, error: `"${identifier}" is not an Azure DevOps work item ref` };
      try {
        const current = await readWorkItem(ref.id);
        const projectName = fieldStr(current, "System.TeamProject") || ref.project || "";
        const type = fieldStr(current, "System.WorkItemType");

        const fields: Record<string, unknown> = { ...(patch.extraFields ?? {}) };
        if (patch.title) fields[AZ_FIELD.title] = patch.title;
        if (patch.assignee) fields[AZ_FIELD.assignedTo] = patch.assignee;
        if (patch.labels?.length) fields[AZ_FIELD.tags] = tagsValue(patch.labels);
        if (patch.priority) fields[AZ_FIELD.priority] = AZ_PRIORITY[patch.priority];
        if (patch.project) fields[AZ_FIELD.areaPath] = patch.project;

        if (patch.state) {
          const valid = await statesFor(projectName, type);
          const canonical = resolveName(patch.state, valid);
          if (!canonical) {
            return {
              ok: false,
              error: valid.length
                ? `state "${patch.state}" not found. Valid states for ${type}: ${valid.join(", ")}`
                : `state "${patch.state}" could not be checked: the states of ${type} could not be read`,
            };
          }
          fields[AZ_FIELD.state] = canonical;
        }

        const ops = fieldOps(fields);
        if (!ops.length) return { ok: false, error: "nothing to update" };

        const r = await az(tok, `/_apis/wit/workitems/${ref.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json-patch+json" },
          body: JSON.stringify(ops),
        });
        if (!r.ok) {
          let error = `Azure DevOps update failed: ${r.status} ${await r.text()}`;
          // An assignee or area path Azure DevOps refuses is almost always a
          // name that is close but not exact, so hand the agent the real list
          // to correct from, the same way a bad state does.
          if (patch.assignee) {
            const members = await projectMembers(projectName).catch(() => []);
            if (members.length) error += `. Valid assignees: ${members.join(", ")}`;
          }
          if (patch.project) {
            const areas = await areaPaths(projectName).catch(() => []);
            if (areas.length) error += `. Valid area paths: ${areas.join(", ")}`;
          }
          return { ok: false, error };
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    async getIssue(identifier) {
      const ref = parseWorkItemRef(identifier);
      if (!ref) throw new Error(`"${identifier}" is not an Azure DevOps work item ref`);
      const wi = await readWorkItem(ref.id);
      const projectName = fieldStr(wi, "System.TeamProject") || ref.project || "";
      return {
        identifier: `${projectName}#${wi.id}`,
        title: fieldStr(wi, AZ_FIELD.title),
        url: workItemUrl(tok.org, projectName, wi.id),
        state: fieldStr(wi, AZ_FIELD.state) || null,
        stateColor: azureStateColor(undefined, fieldStr(wi, AZ_FIELD.state)),
        assignee: fieldStr(wi, AZ_FIELD.assignedTo) || null,
        labels: parseTags(wi.fields?.[AZ_FIELD.tags]),
        priority: priorityName(wi.fields?.[AZ_FIELD.priority]),
        issueType: fieldStr(wi, "System.WorkItemType") || null,
        project: fieldStr(wi, AZ_FIELD.areaPath) || null,
      };
    },

    async getLiveIssues(identifiers): Promise<LiveIssueLookup> {
      const issues: Record<string, LiveIssue> = {};
      const gone: string[] = [];
      const refs = Array.from(new Set(identifiers.filter(Boolean)))
        .map((id) => ({ id, ref: parseWorkItemRef(id) }))
        .filter((x): x is { id: string; ref: { project?: string; id: number } } => !!x.ref);
      if (!refs.length) return { issues, gone };

      const fields = [
        "System.Id",
        AZ_FIELD.title,
        AZ_FIELD.state,
        AZ_FIELD.assignedTo,
        "System.TeamProject",
        "System.CreatedDate",
      ].join(",");

      // 200 is the documented ceiling for the batch read.
      for (const batch of chunk(refs, 200)) {
        try {
          // errorPolicy=Omit is what makes a missing work item a null entry
          // instead of a 404 that would take the whole batch down with it.
          const j = await azJson<{ value?: Array<WorkItem | null> }>(
            tok,
            `/_apis/wit/workitems?ids=${batch.map((b) => b.ref.id).join(",")}` +
              `&fields=${encodeURIComponent(fields)}&errorPolicy=Omit`,
          );
          const byId = new Map(presentItems(j.value).map((wi) => [wi.id, wi]));

          // An omission means deleted OR no longer readable, and a ticket the
          // user lost access to must not show as deleted. Only the recycle bin
          // can tell the two apart.
          const omitted = batch.filter((b) => !byId.has(b.ref.id));
          if (omitted.length) {
            const deleted = await confirmedDeleted(omitted.map((b) => b.ref.id));
            for (const { id, ref } of omitted) if (deleted.has(ref.id)) gone.push(id);
          }

          for (const { id, ref } of batch) {
            const wi = byId.get(ref.id);
            if (!wi) continue;
            const projectName = fieldStr(wi, "System.TeamProject") || ref.project || "";
            const state = fieldStr(wi, AZ_FIELD.state);
            const who = fieldStr(wi, AZ_FIELD.assignedTo);
            issues[id] = {
              identifier: `${projectName}#${wi.id}`,
              title: fieldStr(wi, AZ_FIELD.title),
              url: workItemUrl(tok.org, projectName, wi.id),
              stateName: state,
              stateColor: azureStateColor(undefined, state),
              createdAt: fieldStr(wi, "System.CreatedDate"),
              assignee: who ? { name: who } : undefined,
            };
          }
        } catch {
          // A failed batch says nothing about existence - leave `gone` alone.
          continue;
        }
      }
      return { issues, gone };
    },
  };
}
