import { clerkClient } from "@clerk/nextjs/server";
import { clerkStrategy } from "./clerk-strategies";
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
  matchPriorityLabel,
} from "./tracker";
import { chunk } from "./ticket-sync";

export type GithubTok = { token: string };

const API = "https://api.github.com";
const GRAPHQL = "https://api.github.com/graphql";

const AUTH_EXPIRED =
  "Your GitHub connection has expired - reconnect GitHub under Settings, then retry.";

export async function getGithubToken(userId: string): Promise<GithubTok | null> {
  const client = await clerkClient().catch(() => null);
  if (!client) return null;
  try {
    const res = await client.users.getUserOauthAccessToken(
      userId,
      clerkStrategy("github") as Parameters<typeof client.users.getUserOauthAccessToken>[1],
    );
    const t = res.data?.[0]?.token;
    if (t) return { token: t };
  } catch {
    /* not connected */
  }
  return null;
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/**
 * GitHub issue numbers are only unique within a repository, so a bare "#42"
 * cannot address an issue across a user's whole account. Brief's identifier is
 * the fully qualified "owner/repo#42", which is also exactly what GitHub itself
 * renders for a cross-repo reference.
 */
export function parseIssueRef(
  identifier: string,
): { owner: string; repo: string; number: number } | null {
  const m = /^([^/\s]+)\/([^#\s]+)#(\d+)$/.exec((identifier ?? "").trim());
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

export function issueRef(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`;
}

/** Split a "owner/repo" target id. */
export function parseRepo(targetId: string): { owner: string; repo: string } | null {
  const m = /^([^/\s]+)\/([^/\s]+)$/.exec((targetId ?? "").trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}

// ---------------------------------------------------------------------------
// REST + GraphQL helpers
// ---------------------------------------------------------------------------

async function gh(tok: GithubTok, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${tok.token}`);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const r = await fetch(`${API}${path}`, { ...init, headers });
  if (r.status === 401) throw new Error(AUTH_EXPIRED);
  return r;
}

async function ghJson<T>(tok: GithubTok, path: string, init: RequestInit = {}): Promise<T> {
  const r = await gh(tok, path, init);
  if (!r.ok) throw new Error(`GitHub ${path} failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

export type GraphQLError = { type?: string; message?: string };

/**
 * POST a query and hand back GitHub's raw `{ data, errors }`.
 *
 * Callers need the errors, not just the data: GitHub answers 200 with
 * `data: null` and an INSUFFICIENT_SCOPES error when a query touches a field
 * the token can't read, and the only way to recover is to see which error it
 * was and ask for less.
 */
async function ghGraphQLRaw<T>(
  tok: GithubTok,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<{ data: T | null; errors: GraphQLError[] }> {
  try {
    const r = await fetch(GRAPHQL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (r.status === 401) throw new Error(AUTH_EXPIRED);
    if (!r.ok) return { data: null, errors: [] };
    const j = (await r.json()) as { data?: T; errors?: GraphQLError[] };
    return { data: j.data ?? null, errors: Array.isArray(j.errors) ? j.errors : [] };
  } catch (e) {
    if (e instanceof Error && e.message === AUTH_EXPIRED) throw e;
    return { data: null, errors: [] };
  }
}

/** True when GitHub refused the query because the token lacks a scope. */
export function isInsufficientScopes(errors: GraphQLError[]): boolean {
  return errors.some(
    (e) => e.type === "INSUFFICIENT_SCOPES" || /required scopes/i.test(e.message ?? ""),
  );
}

async function ghGraphQL<T>(
  tok: GithubTok,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T | null> {
  // Projects v2 needs the `project` scope, which a user may not have granted.
  // Losing the board integration must never fail the filing itself.
  const { data } = await ghGraphQLRaw<T>(tok, query, variables);
  return data;
}

// ---------------------------------------------------------------------------
// Projects v2 - where GitHub keeps status and priority
// ---------------------------------------------------------------------------

type ProjectField = {
  id: string;
  name: string;
  options?: Array<{ id: string; name: string }>;
};
type RepoProject = { id: string; title: string; number: number; fields: ProjectField[] };

const PROJECTS_QUERY = `
query RepoProjects($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    projectsV2(first: 10) {
      nodes {
        id title number
        fields(first: 50) {
          nodes {
            ... on ProjectV2SingleSelectField { id name options { id name } }
            ... on ProjectV2Field { id name }
          }
        }
      }
    }
  }
}`;

async function loadProjects(tok: GithubTok, owner: string, repo: string): Promise<RepoProject[]> {
  const d = await ghGraphQL<{
    repository?: {
      projectsV2?: {
        nodes?: Array<{
          id: string;
          title: string;
          number: number;
          fields?: { nodes?: Array<ProjectField | Record<string, never>> };
        }>;
      };
    };
  }>(tok, PROJECTS_QUERY, { owner, name: repo });
  return (d?.repository?.projectsV2?.nodes ?? []).map((p) => ({
    id: p.id,
    title: p.title,
    number: p.number,
    // The union spread yields {} for field types we didn't ask for; drop them.
    fields: (p.fields?.nodes ?? []).filter((f): f is ProjectField => !!(f as ProjectField)?.id),
  }));
}

/** The field a board uses for workflow status, by GitHub's own convention. */
function statusField(p: RepoProject): ProjectField | undefined {
  return p.fields.find((f) => f.name.toLowerCase() === "status" && !!f.options?.length);
}

function priorityField(p: RepoProject): ProjectField | undefined {
  return p.fields.find((f) => f.name.toLowerCase() === "priority" && !!f.options?.length);
}

/** Add an issue to a project board and set one single-select field on it. */
async function setProjectField(
  tok: GithubTok,
  projectId: string,
  issueNodeId: string,
  field: ProjectField,
  optionName: string,
): Promise<boolean> {
  const optionNames = (field.options ?? []).map((o) => o.name);
  const canonical = resolveName(optionName, optionNames);
  const option = field.options?.find((o) => o.name === canonical);
  if (!option) return false;

  const added = await ghGraphQL<{ addProjectV2ItemById?: { item?: { id: string } } }>(
    tok,
    `mutation Add($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } }
    }`,
    { projectId, contentId: issueNodeId },
  );
  const itemId = added?.addProjectV2ItemById?.item?.id;
  if (!itemId) return false;

  const done = await ghGraphQL<{ updateProjectV2ItemFieldValue?: { projectV2Item?: { id: string } } }>(
    tok,
    `mutation SetField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
        value: { singleSelectOptionId: $optionId }
      }) { projectV2Item { id } }
    }`,
    { projectId, itemId, fieldId: field.id, optionId: option.id },
  );
  return !!done?.updateProjectV2ItemFieldValue?.projectV2Item?.id;
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * GitHub fetches every embedded image server-side (through its camo proxy), so
 * a URL only it can't reach renders as a broken image forever. A localhost
 * APP_URL - i.e. local development - is exactly that case, and a broken image
 * in a real ticket is worse than no image.
 */
export function isPubliclyFetchable(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost")) return false;
    if (host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") return false;
    // RFC1918 / link-local: reachable on your network, not from GitHub's.
    if (/^10\./.test(host) || /^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (/^169\.254\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Does this markdown already carry an Evidence section of its own? */
export function hasEvidenceHeading(markdown: string): boolean {
  return /^\s{0,3}#{1,6}\s*evidence\s*$/im.test(markdown ?? "");
}

/**
 * Build the ticket body, with evidence embedded by URL.
 *
 * GitHub has no public image-upload API - the drag-and-drop uploader in the web
 * UI is a private endpoint - so screenshots are embedded from the stable
 * Brief-hosted route instead. Two things this has to get right:
 *
 *  - The agent sometimes writes its own "## Evidence" section despite being
 *    told not to. Appending a second one produced tickets with the heading
 *    twice, the caption once as a bullet and again under the image. So the
 *    images go UNDER an existing heading when there is one.
 *  - A file with no `url` (a keyframe, deleted right after filing) is skipped
 *    rather than linked to something that will 404.
 */
/**
 * Promote a line that is ENTIRELY bold into a real heading.
 *
 * The agent writes section labels as "**Steps to reproduce**", a convention the
 * other adapters already turn into a heading (Jira -> h3, Notion -> heading_3).
 * GitHub renders markdown verbatim, so those arrived as bold paragraphs and the
 * issue had no navigable structure - no anchors, no outline, nothing for the
 * eye to catch when scanning.
 *
 * Only a WHOLE line is promoted. "**Expected** the full name is visible" is a
 * bold lead-in to a sentence, not a section, and turning that into a heading
 * would push its own text onto the next line.
 */
export function promoteSectionHeadings(markdown: string): string {
  return (markdown ?? "")
    .split("\n")
    .map((line) => {
      const m = /^\s{0,3}\*\*(.+?)\*\*\s*$/.exec(line);
      if (!m) return line;
      const text = m[1].trim();
      // A label, not a sentence someone happened to bold entirely.
      if (!text || text.length > 60 || /[.!?]$/.test(text)) return line;
      return `### ${text}`;
    })
    .join("\n");
}

/** The technical details, folded: GitHub renders <details> as a disclosure. */
export function withGithubDetails(body: string, details?: { title: string; markdown: string }): string {
  if (!details?.markdown.trim()) return body;
  return `${body.replace(/\s+$/, "")}\n\n<details>\n<summary>${details.title}</summary>\n\n${details.markdown.trim()}\n\n</details>`;
}

export function buildGithubBody(
  descriptionMarkdown: string,
  evidence: Array<{ filename: string; contentType: string; caption?: string; url?: string }>,
): string {
  const body = promoteSectionHeadings(descriptionMarkdown ?? "").replace(/\s+$/, "");
  const parts: string[] = [];
  let imgN = 0;
  let skipped = 0;

  for (const e of evidence) {
    if (!e.url) continue;
    if (!isPubliclyFetchable(e.url)) {
      skipped += 1;
      continue;
    }
    if (e.contentType.startsWith("image/")) {
      imgN += 1;
      const cap = e.caption?.trim() ? `${e.caption.trim()}\n\n` : "";
      parts.push(`${cap}![Screenshot ${imgN}](${e.url})`);
    } else {
      // GitHub only renders a video player for files on its own CDN, so an
      // external recording can only be a link. It must not be labelled with the
      // file name: the ticket never exposes how the report was captured.
      parts.push(`**Screen recording:** [Watch the screen recording](${e.url})`);
    }
  }

  if (skipped) {
    console.warn(
      `[github-tracker] ${skipped} evidence file(s) not embedded: APP_URL is not reachable from GitHub. ` +
        `Set APP_URL to a public origin to get inline screenshots.`,
    );
  }
  if (!parts.length) return body;

  // Reuse the agent's own heading rather than adding a competing one.
  return hasEvidenceHeading(body)
    ? `${body}\n\n${parts.join("\n\n")}`
    : `${body}\n\n## Evidence\n\n${parts.join("\n\n")}`;
}

// ---------------------------------------------------------------------------
// Tracker implementation
// ---------------------------------------------------------------------------

type RepoRaw = {
  full_name: string;
  name: string;
  description: string | null;
  /** The site this repo serves. The strongest routing signal we have: it maps
   *  the page a bug was reported on to the repo that actually ships it. */
  homepage: string | null;
  language: string | null;
  topics?: string[];
  has_issues: boolean;
  archived: boolean;
  permissions?: { push?: boolean; triage?: boolean };
};

/**
 * What the agent is told about a repository.
 *
 * A bare name is not enough to route by: "brief-marketing-website" and
 * "brief-cloud" look equally plausible for a bug in the app until you know
 * which one serves the URL the reporter was on. GitHub's own homepage, topics
 * and primary language are exactly that missing context, so they are folded
 * into the description the agent reads.
 */
export function describeRepo(r: {
  description?: string | null;
  homepage?: string | null;
  language?: string | null;
  topics?: string[];
}): string | undefined {
  const bits: string[] = [];
  if (r.description?.trim()) bits.push(r.description.trim());
  if (r.homepage?.trim()) bits.push(`Serves: ${r.homepage.trim()}`);
  if (r.topics?.length) bits.push(`Topics: ${r.topics.slice(0, 8).join(", ")}`);
  if (r.language?.trim()) bits.push(`Language: ${r.language.trim()}`);
  return bits.length ? bits.join(". ") : undefined;
}

/** The subset of an issue the aliased live-read query selects. */
type GraphQLIssue = {
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  createdAt?: string;
  assignees?: { nodes?: Array<{ login?: string; avatarUrl?: string }> };
  projectItems?: { nodes?: Array<{ fieldValueByName?: { name?: string } | null }> };
};

type IssueRaw = {
  number: number;
  title: string;
  html_url: string;
  state: string;
  created_at: string;
  body?: string | null;
  labels?: Array<{ name: string } | string>;
  assignees?: Array<{ login: string }>;
  milestone?: { title: string } | null;
  node_id?: string;
  repository_url?: string;
};

function labelNames(issue: IssueRaw): string[] {
  return (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
}

/** Shape of one aliased entry in the live-read response. */
type LiveNodes = Record<string, { issue?: GraphQLIssue } | null>;

/**
 * The batched live-read query. `withBoard` adds the Projects v2 Status field,
 * which is only legal when the token carries `read:project`.
 */
function liveQuery(
  batch: Array<{ ref: { owner: string; repo: string; number: number } }>,
  withBoard: boolean,
): string {
  const board = withBoard
    ? `projectItems(first: 1) {
         nodes {
           fieldValueByName(name: "Status") {
             ... on ProjectV2ItemFieldSingleSelectValue { name }
           }
         }
       }`
    : "";
  return `query {${batch
    .map(
      ({ ref }, i) =>
        `i${i}: repository(owner: ${JSON.stringify(ref.owner)}, name: ${JSON.stringify(ref.repo)}) {
           issue(number: ${ref.number}) {
             number title url state createdAt
             assignees(first: 1) { nodes { login avatarUrl } }
             ${board}
           }
         }`,
    )
    .join("\n")}}`;
}

export function makeGithubTracker(tok: GithubTok): Tracker {
  let reposCache: TrackerTarget[] | null = null;
  // Flips to false the first time GitHub refuses the board field for this
  // token, so the rest of the sync stops paying for a retry it will lose.
  let boardReadable = true;

  async function loadRepos(): Promise<TrackerTarget[]> {
    if (reposCache) return reposCache;
    const out: TrackerTarget[] = [];
    for (let page = 1; page <= 4; page++) {
      const repos = await ghJson<RepoRaw[]>(
        tok,
        `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      );
      for (const r of repos) {
        // A repo with issues disabled, or one we can't write to, is not a place
        // a ticket can land - offering it would only produce a failed filing.
        if (!r.has_issues || r.archived) continue;
        if (r.permissions && !r.permissions.push && !r.permissions.triage) continue;
        out.push({
          id: r.full_name,
          key: r.name,
          name: r.full_name,
          description: describeRepo(r),
        });
      }
      if (repos.length < 100) break;
    }
    reposCache = out;
    return out;
  }

  async function repoLabels(owner: string, repo: string): Promise<string[]> {
    try {
      const labels = await ghJson<Array<{ name: string }>>(
        tok,
        `/repos/${owner}/${repo}/labels?per_page=100`,
      );
      return labels.map((l) => l.name);
    } catch {
      return [];
    }
  }

  async function repoMilestones(
    owner: string,
    repo: string,
  ): Promise<Array<{ number: number; title: string }>> {
    try {
      return await ghJson<Array<{ number: number; title: string }>>(
        tok,
        `/repos/${owner}/${repo}/milestones?state=open&per_page=100`,
      );
    } catch {
      return [];
    }
  }

  return {
    kind: "github",
    targetNoun: "repository",
    capabilities: {
      ...NO_CAPABILITIES,
      labels: true,
      comments: true,
      // Status and priority exist only on a Projects v2 board; the adapter
      // resolves them there (or, for priority, onto an existing label).
      states: true,
      priority: true,
      projects: true,
      // Milestone is offered through the custom-fields mechanism.
      customFields: true,
    },
    bodyGuidance:
      "The description is rendered as GitHub Flavored Markdown, so task lists, tables and fenced code blocks all work. Section labels you write on their own line become real headings. Screenshots are embedded inline as images.",

    async listTargets() {
      return loadRepos();
    },

    async searchIssues(query, opts): Promise<IssueSearchResult[]> {
      const q = query.trim();
      if (!q) return [];
      try {
        // GitHub's search has no "everything I can see" scope, so the search is
        // explicitly scoped to the repos we already listed. Capped at the 10
        // most recently updated, because the qualifier list inflates the query
        // string and GitHub rejects searches over 256 characters.
        const repos = (await loadRepos()).slice(0, 10);
        if (!repos.length) return [];
        const scope = repos.map((r) => `repo:${r.id}`).join(" ");
        const limit = Math.min(Math.max(opts?.limit ?? 15, 1), 50);
        const search = `${q} is:issue ${scope}`;
        const j = await ghJson<{ items?: IssueRaw[] }>(
          tok,
          `/search/issues?q=${encodeURIComponent(search)}&per_page=${limit}`,
        );
        return (j.items ?? []).map((i) => {
          // The search payload identifies the repo only by its API url.
          const parts = (i.repository_url ?? "").split("/");
          const repoFull = parts.length >= 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : "";
          return {
            identifier: repoFull ? `${repoFull}#${i.number}` : `#${i.number}`,
            title: i.title,
            url: i.html_url,
            target: repoFull,
            state: i.state === "closed" ? "Closed" : "Open",
            labels: labelNames(i),
            assignee: i.assignees?.[0]?.login,
          };
        });
      } catch {
        return [];
      }
    },

    async getTargetDetails(targetId): Promise<TargetDetails> {
      const ref = parseRepo(targetId);
      if (!ref) {
        const known = (await loadRepos()).map((r) => r.id).join(", ");
        throw new Error(
          `GitHub: "${targetId}" is not a repository id. Use owner/repo. Known repositories: ${known}`,
        );
      }
      const { owner, repo } = ref;
      const [labels, assignees, milestones, projects] = await Promise.all([
        repoLabels(owner, repo),
        ghJson<Array<{ login: string }>>(tok, `/repos/${owner}/${repo}/assignees?per_page=100`).catch(
          () => [] as Array<{ login: string }>,
        ),
        repoMilestones(owner, repo),
        loadProjects(tok, owner, repo),
      ]);

      // Status options come from the board, since a bare GitHub issue is only
      // open or closed and "open" is never a useful thing to ask the agent for.
      const statuses = projects.flatMap((p) => statusField(p)?.options?.map((o) => o.name) ?? []);

      const customFields: TargetDetails["customFields"] = [];
      if (milestones.length) {
        customFields.push({
          id: "milestone",
          name: "Milestone",
          type: "single-select",
          allowedValues: milestones.map((m) => m.title),
        });
      }
      for (const p of projects) {
        for (const f of p.fields) {
          if (!f.options?.length) continue;
          const lower = f.name.toLowerCase();
          // Status and Priority are already reachable via state/priority.
          if (lower === "status" || lower === "priority") continue;
          customFields.push({
            id: `project:${p.number}:${f.name}`,
            name: `${f.name} (board: ${p.title})`,
            type: "single-select",
            allowedValues: f.options.map((o) => o.name),
          });
        }
      }

      return {
        id: targetId,
        key: repo,
        name: targetId,
        description: (await loadRepos()).find((r) => r.id === targetId)?.description,
        states: Array.from(new Set(statuses)),
        labels,
        members: assignees.map((a) => a.login),
        projects: projects.map((p) => ({ id: String(p.number), name: p.title })),
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
      const ref = parseRepo(targetId);
      if (!ref) throw new Error(`GitHub: "${targetId}" is not a repository id (expected owner/repo).`);
      const { owner, repo } = ref;

      const body = withBriefAttribution(withGithubDetails(buildGithubBody(descriptionMarkdown, evidence), details));

      const existing = await repoLabels(owner, repo);
      const norm = (s: string) => s.trim().toLowerCase();
      // Only labels the repo already has - a typo'd label would otherwise be
      // silently created by GitHub and pollute the repo's label set.
      const resolvedLabels = (labels ?? [])
        .map((want) => existing.find((l) => norm(l) === norm(want)) ?? resolveName(want, existing))
        .filter((l): l is string => !!l);

      // No priority field on GitHub: fall back to the repo's own label
      // convention. The board's Priority field is applied separately below.
      if (priority) {
        const plabel = matchPriorityLabel(priority, existing);
        if (plabel && !resolvedLabels.includes(plabel)) resolvedLabels.push(plabel);
      }

      let milestoneNumber: number | undefined;
      const wantMilestone = (extraFields ?? {}).milestone;
      if (typeof wantMilestone === "string" && wantMilestone.trim()) {
        const all = await repoMilestones(owner, repo);
        const canonical = resolveName(wantMilestone, all.map((m) => m.title));
        milestoneNumber = all.find((m) => m.title === canonical)?.number;
      }

      // extraFields carries our own pseudo-fields (milestone, project:*) which
      // are not GitHub API fields - strip them before the passthrough.
      const passthrough = Object.fromEntries(
        Object.entries(extraFields ?? {}).filter(
          ([k]) => k !== "milestone" && !k.startsWith("project:"),
        ),
      );

      const created = await ghJson<IssueRaw>(tok, `/repos/${owner}/${repo}/issues`, {
        method: "POST",
        body: JSON.stringify({
          ...passthrough,
          title,
          body,
          ...(resolvedLabels.length ? { labels: resolvedLabels } : {}),
          ...(assignee ? { assignees: [assignee.replace(/^@/, "")] } : {}),
          ...(milestoneNumber ? { milestone: milestoneNumber } : {}),
        }),
      });

      // Board placement: status, priority, and any other single-select the
      // agent set. Best-effort throughout - the issue already exists, and a
      // missing `project` scope must not turn a filed ticket into a failure.
      if ((state || priority || project) && created.node_id) {
        try {
          const projects = await loadProjects(tok, owner, repo);
          const board =
            (project
              ? projects.find(
                  (p) => String(p.number) === project || norm(p.title) === norm(project),
                )
              : undefined) ?? projects[0];
          if (board) {
            if (state) {
              const f = statusField(board);
              if (f) await setProjectField(tok, board.id, created.node_id, f, state);
            }
            if (priority) {
              const f = priorityField(board);
              if (f) await setProjectField(tok, board.id, created.node_id, f, priority);
            }
            for (const [k, v] of Object.entries(extraFields ?? {})) {
              if (!k.startsWith("project:") || typeof v !== "string") continue;
              const fieldName = k.split(":").slice(2).join(":");
              const f = board.fields.find((x) => norm(x.name) === norm(fieldName));
              if (f) await setProjectField(tok, board.id, created.node_id, f, v);
            }
          }
        } catch (err) {
          console.warn("[github-tracker] board placement failed:", err);
        }
      }

      if (comment?.trim()) {
        try {
          await ghJson(tok, `/repos/${owner}/${repo}/issues/${created.number}/comments`, {
            method: "POST",
            body: JSON.stringify({ body: comment.trim() }),
          });
        } catch (err) {
          console.warn("[github-tracker] comment post failed:", err);
        }
      }

      return {
        id: created.node_id ?? String(created.number),
        identifier: issueRef(owner, repo, created.number),
        url: created.html_url,
        title: created.title,
      };
    },

    async updateIssue(identifier, patch: IssuePatch): Promise<UpdateResult> {
      const ref = parseIssueRef(identifier);
      if (!ref) return { ok: false, error: `"${identifier}" is not a GitHub issue ref (expected owner/repo#123)` };
      const { owner, repo, number } = ref;
      try {
        const existing = await repoLabels(owner, repo);
        const fields: Record<string, unknown> = {
          ...Object.fromEntries(
            Object.entries(patch.extraFields ?? {}).filter(
              ([k]) => k !== "milestone" && !k.startsWith("project:"),
            ),
          ),
        };
        if (patch.title) fields.title = patch.title;
        if (patch.assignee) fields.assignees = [patch.assignee.replace(/^@/, "")];

        if (patch.labels?.length) {
          const resolved: string[] = [];
          const missing: string[] = [];
          for (const want of patch.labels) {
            const hit = resolveName(want, existing);
            if (hit) resolved.push(hit);
            else missing.push(want);
          }
          if (missing.length) {
            return {
              ok: false,
              error: `labels not found: ${missing.join(", ")}. Valid labels: ${existing.join(", ")}`,
            };
          }
          fields.labels = resolved;
        }

        if (patch.priority) {
          const plabel = matchPriorityLabel(patch.priority, existing);
          if (plabel) {
            const current = (fields.labels as string[] | undefined) ?? [];
            fields.labels = Array.from(new Set([...current, plabel]));
          }
        }

        if (Object.keys(fields).length) {
          const r = await gh(tok, `/repos/${owner}/${repo}/issues/${number}`, {
            method: "PATCH",
            body: JSON.stringify(fields),
          });
          if (!r.ok) return { ok: false, error: `GitHub update failed: ${r.status} ${await r.text()}` };
        }

        if (patch.state) {
          const projects = await loadProjects(tok, owner, repo);
          const issue = await ghJson<IssueRaw>(tok, `/repos/${owner}/${repo}/issues/${number}`);
          const board = projects.find((p) => statusField(p));
          const f = board ? statusField(board) : undefined;
          const applied =
            board && f && issue.node_id
              ? await setProjectField(tok, board.id, issue.node_id, f, patch.state)
              : false;
          if (!applied) {
            const options = projects.flatMap((p) => statusField(p)?.options?.map((o) => o.name) ?? []);
            return {
              ok: false,
              error: options.length
                ? `state "${patch.state}" could not be set. Valid statuses on this repository's project board: ${options.join(", ")}`
                : `this repository has no project board with a Status field, so a workflow state cannot be set (a GitHub issue is only open or closed)`,
            };
          }
        }

        if (!Object.keys(fields).length && !patch.state) return { ok: false, error: "nothing to update" };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    async getIssue(identifier) {
      const ref = parseIssueRef(identifier);
      if (!ref) throw new Error(`"${identifier}" is not a GitHub issue ref (expected owner/repo#123)`);
      const { owner, repo, number } = ref;
      const i = await ghJson<IssueRaw>(tok, `/repos/${owner}/${repo}/issues/${number}`);
      // The board status is the meaningful "state" for a GitHub ticket, so the
      // agent's verify step reads back what it actually set, not "open".
      let boardStatus: string | null = null;
      const d = await ghGraphQL<{
        repository?: {
          issue?: {
            projectItems?: {
              nodes?: Array<{ fieldValueByName?: { name?: string } | null }>;
            };
          };
        };
      }>(
        tok,
        `query IssueStatus($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            issue(number: $number) {
              projectItems(first: 1) {
                nodes {
                  fieldValueByName(name: "Status") {
                    ... on ProjectV2ItemFieldSingleSelectValue { name }
                  }
                }
              }
            }
          }
        }`,
        { owner, name: repo, number },
      );
      boardStatus = d?.repository?.issue?.projectItems?.nodes?.[0]?.fieldValueByName?.name ?? null;

      const labels = labelNames(i);
      return {
        identifier: issueRef(owner, repo, i.number),
        title: i.title,
        url: i.html_url,
        state: boardStatus ?? (i.state === "closed" ? "Closed" : "Open"),
        stateColor: i.state === "closed" ? STATUS_COLOR.done : STATUS_COLOR.active,
        assignee: i.assignees?.[0]?.login ?? null,
        labels,
        milestone: i.milestone?.title ?? null,
        priority:
          (["urgent", "high", "medium", "low"] as TrackerPriority[]).find(
            (p) => matchPriorityLabel(p, labels) !== undefined,
          ) ?? null,
      };
    },

    async getLiveIssues(identifiers): Promise<LiveIssueLookup> {
      const issues: Record<string, LiveIssue> = {};
      const gone: string[] = [];
      const refs = Array.from(new Set(identifiers.filter(Boolean)))
        .map((id) => ({ id, ref: parseIssueRef(id) }))
        .filter((x): x is { id: string; ref: NonNullable<ReturnType<typeof parseIssueRef>> } => !!x.ref);
      if (!refs.length) return { issues, gone };

      // One aliased GraphQL query per batch instead of one REST call per issue,
      // so a feed of 50 filed tickets costs two requests rather than fifty.
      for (const batch of chunk(refs, 25)) {
        let d = (await ghGraphQLRaw<LiveNodes>(tok, liveQuery(batch, boardReadable))).data;

        if (!d && boardReadable) {
          // The board status is a nice-to-have that needs `read:project`, and
          // GitHub rejects the WHOLE query when the token lacks it - which used
          // to leave the feed permanently frozen, showing no status changes and
          // no deletions. Ask again without it, and stop asking for this token.
          const retry = await ghGraphQLRaw<LiveNodes>(tok, liveQuery(batch, false));
          if (retry.data) {
            // The board field was what GitHub objected to; nothing else has to
            // be true for that conclusion to hold.
            boardReadable = false;
            d = retry.data;
          }
        }

        // A failed batch tells us nothing about whether these issues exist, so
        // it must leave `gone` alone - the rows fall back to their snapshot.
        if (!d) continue;

        batch.forEach(({ id }, i) => {
          const node = d[`i${i}`];
          if (node === undefined) return;
          const issue = node?.issue;
          if (!issue) {
            // The repository resolved but the issue did not: GitHub positively
            // reports it is gone (deleted or transferred away).
            if (node !== null) gone.push(id);
            return;
          }
          const boardStatus = issue.projectItems?.nodes?.[0]?.fieldValueByName?.name;
          const closed = issue.state === "CLOSED";
          const a = issue.assignees?.nodes?.[0];
          issues[id] = {
            identifier: id,
            title: issue.title ?? "",
            url: issue.url ?? "",
            stateName: boardStatus || (closed ? "Closed" : "Open"),
            stateColor: closed ? STATUS_COLOR.done : STATUS_COLOR.active,
            createdAt: issue.createdAt ?? "",
            assignee: a?.login ? { name: a.login, avatarUrl: a.avatarUrl } : undefined,
          };
        });
      }
      return { issues, gone };
    },
  };
}

/**
 * The orgs this token can see, for the org picker on Connections.
 *
 * Unlike Linear and Jira, a GitHub user belongs to MANY orgs at once, so
 * there is no "their" org to infer - listTargets already spans
 * owner/collaborator/organization_member repos. The user picks one; until they
 * do they simply have no org, which is better than guessing wrong and sharing
 * their preferences with the wrong company.
 *
 * `/user/orgs` alone is NOT enough. It needs the `read:org` scope, and the
 * Clerk connection requests `read:user, repo, user:email` - so it answers 200
 * with an empty array even for someone who is in orgs, and the picker would be
 * permanently empty for everyone. The repo list is the reliable source: `repo`
 * is already granted, and every repo names its owner.
 *
 * The affiliation is `organization_member` ONLY - deliberately not
 * `collaborator`. GitHub defines organization_member as repositories reached
 * through membership of the owning organization, which is the membership proof
 * we need. Including collaborator would let an outside collaborator on a single
 * repo claim that company's org - and the org key is what grants read access to
 * its leaderboard and write access to its shared filing rules.
 */
export async function listGithubOrgs(
  tok: GithubTok,
): Promise<Array<{ login: string; name: string; avatarUrl?: string }>> {
  const byLogin = new Map<string, { login: string; name: string; avatarUrl?: string }>();

  // Primary source: owners of the repos this token can see.
  try {
    for (let page = 1; page <= 3; page++) {
      const repos = await ghJson<
        Array<{ owner?: { login?: string; type?: string; avatar_url?: string } }>
      >(
        tok,
        `/user/repos?per_page=100&page=${page}&affiliation=organization_member`,
      );
      for (const r of repos) {
        const o = r.owner;
        if (o?.login && o.type === "Organization" && !byLogin.has(o.login)) {
          byLogin.set(o.login, { login: o.login, name: o.login, avatarUrl: o.avatar_url });
        }
      }
      if (repos.length < 100) break;
    }
  } catch {
    /* fall through to /user/orgs */
  }

  // Secondary: if the token DOES carry read:org, this adds orgs the user is in
  // but has no visible repo for.
  try {
    const orgs = await ghJson<Array<{ login?: string; avatar_url?: string }>>(
      tok,
      "/user/orgs?per_page=100",
    );
    for (const o of orgs) {
      if (o.login && !byLogin.has(o.login)) {
        byLogin.set(o.login, { login: o.login, name: o.login, avatarUrl: o.avatar_url });
      }
    }
  } catch {
    /* no org scope, or GitHub is down - the repo-derived list still stands */
  }

  return [...byLogin.values()].sort((a, b) => a.login.localeCompare(b.login));
}
