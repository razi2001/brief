import { clerkClient } from "@clerk/nextjs/server";
import { resolveName, type IssuePatch, type IssueSearchResult, type TargetDetails, type Tracker, type TrackerTarget, type UpdateResult } from "./tracker";
import { chunk } from "./ticket-sync";

export type JiraTok = { token: string; kind: "oauth" | "basic" };

// ---------------------------------------------------------------------------
// ADF (Atlassian Document Format) builder - pure, unit-tested in jira.test.ts.
// ---------------------------------------------------------------------------

export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface AdfNode {
  type: string;
  version?: number;
  text?: string;
  content?: AdfNode[];
  marks?: AdfMark[];
  attrs?: Record<string, unknown>;
}

// Inline markdown → ADF text nodes: **bold**, `code`, [label](url), ![alt](url).
// (Jira attaches evidence separately, so an image renders as a link to its URL.)
const INLINE_RE = /(!\[[^\]]*\]\([^)]+\))|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(`[^`]+`)/g;

function parseInline(input: string): AdfNode[] {
  const text = input.trim();
  const out: AdfNode[] = [];
  const push = (t: string, marks?: AdfMark[]) => {
    if (!t) return;
    out.push(marks && marks.length ? { type: "text", text: t, marks } : { type: "text", text: t });
  };
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text))) {
    if (m.index > last) push(text.slice(last, m.index));
    const tok = m[0];
    if (m[1]) {
      const im = /!\[([^\]]*)\]\(([^)]+)\)/.exec(tok)!;
      push(im[1] || "image", [{ type: "link", attrs: { href: im[2] } }]);
    } else if (m[2]) {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!;
      push(lm[1], [{ type: "link", attrs: { href: lm[2] } }]);
    } else if (m[3]) {
      push(tok.slice(2, -2), [{ type: "strong" }]);
    } else if (m[4]) {
      push(tok.slice(1, -1), [{ type: "code" }]);
    }
    last = INLINE_RE.lastIndex;
  }
  if (last < text.length) push(text.slice(last));
  if (!out.length) out.push({ type: "text", text: text || " " });
  return out;
}

/**
 * Convert a markdown description into proper ADF so Jira renders it nicely
 * (headings, bold, numbered/bullet lists, code blocks) instead of literal
 * markdown. Supports the structure our agent emits.
 */
export function markdownToAdf(markdown: string): AdfNode {
  const lines = (markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const content: AdfNode[] = [];
  const isOrdered = (l: string) => /^\s*\d+\.\s+/.test(l);
  const isBullet = (l: string) => /^\s*[-*]\s+/.test(l);
  const isWholeBold = (l: string) => /^\*\*(.+)\*\*$/.test(l.trim());
  const isHeading = (l: string) => /^#{1,6}\s+/.test(l);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // Fenced code block ```
    if (/^```/.test(line.trim())) {
      const lang = line.trim().slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { code.push(lines[i]); i++; }
      i++; // closing fence
      content.push({
        type: "codeBlock",
        attrs: lang ? { language: lang } : {},
        content: [{ type: "text", text: code.join("\n") || " " }],
      });
      continue;
    }

    // Markdown heading (## Title)
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      content.push({ type: "heading", attrs: { level: Math.min(h[1].length, 6) }, content: parseInline(h[2]) });
      i++; continue;
    }

    // A whole line wrapped in ** ** is a section label → heading level 3.
    const wb = /^\*\*(.+)\*\*$/.exec(line.trim());
    if (wb) {
      content.push({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: wb[1].trim() }] });
      i++; continue;
    }

    // Ordered list
    if (isOrdered(line)) {
      const items: AdfNode[] = [];
      while (i < lines.length && isOrdered(lines[i])) {
        const t = lines[i].replace(/^\s*\d+\.\s+/, "");
        items.push({ type: "listItem", content: [{ type: "paragraph", content: parseInline(t) }] });
        i++;
      }
      content.push({ type: "orderedList", attrs: { order: 1 }, content: items });
      continue;
    }

    // Bullet list
    if (isBullet(line)) {
      const items: AdfNode[] = [];
      while (i < lines.length && isBullet(lines[i])) {
        const t = lines[i].replace(/^\s*[-*]\s+/, "");
        items.push({ type: "listItem", content: [{ type: "paragraph", content: parseInline(t) }] });
        i++;
      }
      content.push({ type: "bulletList", content: items });
      continue;
    }

    // Paragraph - gather consecutive plain lines until a blank or a special block.
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i].trim()) &&
      !isHeading(lines[i]) &&
      !isWholeBold(lines[i]) &&
      !isOrdered(lines[i]) &&
      !isBullet(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    content.push({ type: "paragraph", content: parseInline(para.join(" ")) });
  }

  if (content.length === 0) {
    content.push({ type: "paragraph", content: [{ type: "text", text: " " }] });
  }
  return { type: "doc", version: 1, content };
}

// ---------------------------------------------------------------------------
// Precedent search (pure helpers, unit-tested in jira.test.ts)
// ---------------------------------------------------------------------------

/** Build a JQL text search over summary+description for routing/labeling precedent. */
export function buildSearchJql(query: string): string {
  const q = query
    .replace(/["\\]/g, " ")                 // JQL string delimiters
    .replace(/[+\-&|!(){}[\]^~*?:/]/g, " ")  // Lucene operator chars (400 in ~ search)
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return "ORDER BY updated DESC";
  return `(summary ~ "${q}" OR description ~ "${q}") ORDER BY updated DESC`;
}

interface JiraSearchRaw {
  key: string;
  fields?: {
    summary?: string;
    status?: { name?: string };
    assignee?: { displayName?: string };
    labels?: string[];
    priority?: { name?: string };
    project?: { name?: string };
    issuetype?: { name?: string };
  };
}

/** Normalize a Jira priority name to our TrackerPriority vocabulary (urgent/high/medium/low). */
export function normalizeJiraPriority(name?: string): string | undefined {
  switch ((name ?? "").toLowerCase()) {
    case "highest": return "urgent";
    case "high": return "high";
    case "medium": return "medium";
    case "low": return "low";
    case "lowest": return "low";
    default: return name ? name.toLowerCase() : undefined;
  }
}

/** Map a Jira search hit to the provider-agnostic IssueSearchResult. */
export function mapJiraSearchIssue(issue: JiraSearchRaw, siteUrl: string): IssueSearchResult {
  const f = issue.fields ?? {};
  return {
    identifier: issue.key,
    title: f.summary ?? "",
    url: `${siteUrl}/browse/${issue.key}`,
    target: f.project?.name ?? "",
    state: f.status?.name ?? undefined,
    labels: f.labels ?? [],
    assignee: f.assignee?.displayName ?? undefined,
    priority: normalizeJiraPriority(f.priority?.name),
    issueType: f.issuetype?.name ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Auth + cloudId discovery
// ---------------------------------------------------------------------------

export async function getJiraAuth(userId: string): Promise<JiraTok | null> {
  // Productized path: Clerk-vended OAuth token for the Atlassian connected account.
  const client = await clerkClient().catch(() => null);
  if (client) {
    try {
      const res = await client.users.getUserOauthAccessToken(userId, "oauth_atlassian");
      const t = res.data?.[0]?.token;
      if (t) return { token: t, kind: "oauth" };
    } catch { /* not connected - fall through */ }
  }
  // Testing fallback: API token + email (basic auth) against a single site.
  const apiToken = process.env.JIRA_API_TOKEN;
  const email = process.env.JIRA_EMAIL;
  if (apiToken && email) {
    return { token: Buffer.from(`${email}:${apiToken}`).toString("base64"), kind: "basic" };
  }
  return null;
}

interface AccessibleResource {
  id: string;
  url: string;
  name?: string;
  scopes?: string[];
}

/**
 * Resolve the Atlassian cloudId (+ the site url for building browse links).
 * OAuth: GET accessible-resources. Basic fallback: derive from JIRA_SITE env.
 */
export async function getJiraCloud(
  tok: JiraTok
): Promise<{ cloudId: string; siteUrl: string } | null> {
  if (tok.kind === "oauth") {
    const r = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
      headers: { Authorization: `Bearer ${tok.token}`, Accept: "application/json" },
    });
    if (!r.ok) return null;
    const resources = (await r.json()) as AccessibleResource[];
    const first = resources?.[0];
    if (!first?.id) return null;
    return { cloudId: first.id, siteUrl: first.url };
  }
  // Basic fallback uses a fixed site; cloudId isn't needed because we hit the
  // site domain directly. We encode the site url as the "cloudId" sentinel.
  const site = process.env.JIRA_SITE;
  if (!site) return null;
  const siteUrl = site.replace(/\/+$/, "");
  return { cloudId: `basic:${siteUrl}`, siteUrl };
}

// ---------------------------------------------------------------------------
// Jira REST helpers
// ---------------------------------------------------------------------------

function jiraBase(tok: JiraTok, cloudId: string, siteUrl: string): string {
  // OAuth goes through the api.atlassian.com gateway; basic auth hits the site directly.
  if (tok.kind === "oauth") return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`;
  return `${siteUrl}/rest/api/3`;
}

function authHeader(tok: JiraTok): string {
  return tok.kind === "oauth" ? `Bearer ${tok.token}` : `Basic ${tok.token}`;
}

async function jiraFetch(
  tok: JiraTok,
  base: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", authHeader(tok));
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  return fetch(`${base}${path}`, { ...init, headers });
}

// ---------------------------------------------------------------------------
// Live issue enrichment (titles + status) for the dashboard
// ---------------------------------------------------------------------------

export interface JiraIssueInfo {
  title: string;
  url: string;
  stateName: string;
  stateColor: string;
  createdAt: string;
}

/** Map Jira's statusCategory.colorName to one of our brand status colors. */
function jiraStatusColor(colorName?: string): string {
  switch ((colorName ?? "").toLowerCase()) {
    case "blue-gray":
      return "#8a8378";
    case "yellow":
      return "#dd6936";
    case "green":
      return "#2e7d32";
    default:
      return "#8a8378";
  }
}

/**
 * Fetch live Jira issue info (summary + status) for a set of issue keys via
 * JQL search, 25 keys per request - larger sets are CHUNKED into several
 * requests instead of silently dropped. Tries the newer `/search/jql` endpoint
 * first and falls back to the legacy `/search` if that 404s.
 *
 * Defensive by design: any failure returns what it has so a Jira outage or
 * token problem never breaks the dashboard render.
 */
export async function getJiraIssues(
  tok: JiraTok,
  cloud: { cloudId: string; siteUrl: string },
  keys: string[],
): Promise<Record<string, JiraIssueInfo>> {
  const out: Record<string, JiraIssueInfo> = {};
  try {
    const ids = Array.from(new Set(keys.filter(Boolean)));
    if (ids.length === 0) return out;

    const base = jiraBase(tok, cloud.cloudId, cloud.siteUrl);
    for (const batch of chunk(ids, 25)) {
      const jql = `key in (${batch.join(",")})`;
      const fields = "summary,status,created";
      const qs = `?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fields)}&maxResults=${batch.length}`;

      // Try the newer /search/jql first, fall back to legacy /search on 404.
      let r = await jiraFetch(tok, base, `/search/jql${qs}`);
      if (r.status === 404) r = await jiraFetch(tok, base, `/search${qs}`);
      if (!r.ok) continue;

      const j = (await r.json()) as {
        issues?: Array<{
          key: string;
          fields?: {
            summary?: string;
            created?: string;
            status?: {
              name?: string;
              statusCategory?: { colorName?: string };
            };
          };
        }>;
      };

      for (const issue of j.issues ?? []) {
        if (!issue.key) continue;
        const f = issue.fields ?? {};
        out[issue.key] = {
          title: f.summary ?? "",
          url: `${cloud.siteUrl}/browse/${issue.key}`,
          stateName: f.status?.name ?? "",
          stateColor: jiraStatusColor(f.status?.statusCategory?.colorName),
          createdAt: f.created ?? "",
        };
      }
    }
    return out;
  } catch {
    return out;
  }
}

// ---------------------------------------------------------------------------
// Workflow transitions
// ---------------------------------------------------------------------------

export type JiraTransition = { id: string; name: string; to?: { name?: string } };

/**
 * Pick the workflow transition that reaches a wanted status. Jira moves issues
 * between statuses via named transitions, so we match the wanted status first
 * against each transition's DESTINATION (to.name), then against the transition
 * name itself - both fuzzily (exact > prefix > substring, case-insensitive).
 */
export function pickTransition(
  want: string,
  transitions: JiraTransition[],
): JiraTransition | undefined {
  const dests = transitions.map((t) => t.to?.name ?? "");
  const destHit = resolveName(want, dests);
  if (destHit) return transitions[dests.indexOf(destHit)];
  const names = transitions.map((t) => t.name);
  const nameHit = resolveName(want, names);
  return nameHit ? transitions[names.indexOf(nameHit)] : undefined;
}

// ---------------------------------------------------------------------------
// Tracker implementation
// ---------------------------------------------------------------------------

/** Jira priority names for our normalized priorities. */
const JIRA_PRIORITY: Record<string, string> = {
  urgent: "Highest",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function makeJiraTracker(tok: JiraTok, cloud: { cloudId: string; siteUrl: string }): Tracker {
  const base = jiraBase(tok, cloud.cloudId, cloud.siteUrl);

  async function pickIssueType(projectKey: string): Promise<string> {
    // GET createmeta → projects[].issuetypes[]; prefer Bug, then Task, else first.
    const r = await jiraFetch(
      tok,
      base,
      `/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&expand=projects.issuetypes`
    );
    if (!r.ok) throw new Error(`Jira createmeta failed: ${r.status} ${await r.text()}`);
    const j = (await r.json()) as {
      projects?: Array<{ issuetypes?: Array<{ id: string; name: string; subtask?: boolean }> }>;
    };
    const types = (j.projects?.[0]?.issuetypes ?? []).filter((t) => !t.subtask);
    if (!types.length) throw new Error(`Jira: no issue types for project ${projectKey}`);
    const byName = (n: string) => types.find((t) => t.name.toLowerCase() === n);
    const chosen = byName("bug") ?? byName("task") ?? types[0];
    return chosen.id;
  }

  // Projects, fetched once per tracker instance (paginated /project/search).
  let targetsCache: TrackerTarget[] | null = null;
  async function loadTargets(): Promise<TrackerTarget[]> {
    if (targetsCache) return targetsCache;
    const out: TrackerTarget[] = [];
    let startAt = 0;
    for (;;) {
      const r = await jiraFetch(tok, base, `/project/search?expand=description&startAt=${startAt}&maxResults=50`);
      if (!r.ok) throw new Error(`Jira project/search failed: ${r.status} ${await r.text()}`);
      const j = (await r.json()) as {
        values?: Array<{ id: string; key: string; name: string; description?: string }>;
        isLast?: boolean;
        total?: number;
      };
      for (const p of j.values ?? []) out.push({ id: p.id, key: p.key, name: p.name, description: p.description || undefined });
      if (j.isLast || !(j.values?.length)) break;
      startAt += j.values.length;
      if (out.length >= (j.total ?? out.length)) break;
    }
    targetsCache = out;
    return out;
  }

  // Resolve an assignee to a Jira accountId via assignable-user search.
  async function resolveAssigneeAccountId(projectKey: string, want: string): Promise<string | undefined> {
    try {
      const r = await jiraFetch(
        tok,
        base,
        `/user/assignable/search?project=${encodeURIComponent(projectKey)}&query=${encodeURIComponent(want)}&maxResults=1`,
      );
      if (!r.ok) return undefined;
      const users = (await r.json()) as Array<{ accountId: string }>;
      return users?.[0]?.accountId;
    } catch {
      return undefined;
    }
  }

  // Move an issue to a wanted status via the transitions API. Reports failure
  // with the reachable statuses so the agent can correct itself.
  async function transitionTo(issueKey: string, want: string): Promise<UpdateResult> {
    const r = await jiraFetch(tok, base, `/issue/${issueKey}/transitions`);
    if (!r.ok) return { ok: false, error: `Jira transitions fetch failed: ${r.status}` };
    const j = (await r.json()) as { transitions?: JiraTransition[] };
    const transitions = j.transitions ?? [];
    const t = pickTransition(want, transitions);
    if (!t) {
      const reachable = transitions.map((x) => x.to?.name || x.name).filter(Boolean).join(", ");
      return { ok: false, error: `no transition reaches status "${want}". Reachable from here: ${reachable || "(none)"}` };
    }
    const post = await jiraFetch(tok, base, `/issue/${issueKey}/transitions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transition: { id: t.id } }),
    });
    if (!post.ok) return { ok: false, error: `Jira transition failed: ${post.status} ${await post.text()}` };
    return { ok: true };
  }

  return {
    kind: "jira",
    targetNoun: "project",
    async listTargets(): Promise<TrackerTarget[]> {
      return loadTargets();
    },
    async searchIssues(query: string, opts?: { limit?: number }): Promise<IssueSearchResult[]> {
      if (!query.trim()) return [];
      try {
        const jql = buildSearchJql(query);
        const fields = "summary,status,assignee,labels,priority,project,issuetype";
        const limit = Math.min(Math.max(opts?.limit ?? 15, 1), 50);
        const qs = `?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fields)}&maxResults=${limit}`;
        // Same endpoint dance as getJiraIssues: newer /search/jql, legacy /search on 404.
        let r = await jiraFetch(tok, base, `/search/jql${qs}`);
        if (r.status === 404) r = await jiraFetch(tok, base, `/search${qs}`);
        if (!r.ok) return [];
        const j = (await r.json()) as { issues?: JiraSearchRaw[] };
        return (j.issues ?? []).map((i) => mapJiraSearchIssue(i, cloud.siteUrl));
      } catch {
        return [];
      }
    },
    async getTargetDetails(targetId): Promise<TargetDetails> {
      const targets = await loadTargets();
      const project = targets.find((t) => t.id === targetId || t.key === targetId);
      if (!project) {
        const known = targets.map((t) => `${t.name} (${t.key}, id: ${t.id})`).join(", ");
        throw new Error(`Jira: project ${targetId} not found. Known projects: ${known}`);
      }
      const key = project.key;

      // Fetched in parallel; each piece degrades to empty on failure so one
      // flaky endpoint doesn't hide the rest of the metadata.
      const [statuses, members, labels, fieldsMeta] = await Promise.all([
        (async () => {
          try {
            const r = await jiraFetch(tok, base, `/project/${encodeURIComponent(key)}/statuses`);
            if (!r.ok) return [] as string[];
            const j = (await r.json()) as Array<{ statuses?: Array<{ name?: string }> }>;
            return [...new Set(j.flatMap((t) => (t.statuses ?? []).map((s) => s.name ?? "")).filter(Boolean))];
          } catch {
            return [] as string[];
          }
        })(),
        (async () => {
          try {
            // Jira's assignable-user search documents `query` as required
            // (400 without it on some sites) - try with an empty query first,
            // then without the param, and degrade to [] if both fail.
            let r = await jiraFetch(tok, base, `/user/assignable/search?project=${encodeURIComponent(key)}&query=&maxResults=50`);
            if (!r.ok) r = await jiraFetch(tok, base, `/user/assignable/search?project=${encodeURIComponent(key)}&maxResults=50`);
            if (!r.ok) return [] as string[];
            const j = (await r.json()) as Array<{ displayName?: string }>;
            return j.map((u) => u.displayName ?? "").filter(Boolean);
          } catch {
            return [] as string[];
          }
        })(),
        (async () => {
          try {
            const r = await jiraFetch(tok, base, `/label?maxResults=100`);
            if (!r.ok) return [] as string[];
            const j = (await r.json()) as { values?: string[] };
            return (j.values ?? []).slice(0, 100);
          } catch {
            return [] as string[];
          }
        })(),
        (async () => {
          try {
            const r = await jiraFetch(
              tok,
              base,
              `/issue/createmeta?projectKeys=${encodeURIComponent(key)}&expand=projects.issuetypes.fields`,
            );
            if (!r.ok) return null;
            return (await r.json()) as {
              projects?: Array<{
                issuetypes?: Array<{
                  name: string;
                  subtask?: boolean;
                  fields?: Record<
                    string,
                    { name?: string; required?: boolean; schema?: { type?: string }; allowedValues?: Array<{ name?: string; value?: string }> }
                  >;
                }>;
              }>;
            };
          } catch {
            return null;
          }
        })(),
      ]);

      const issueTypes = (fieldsMeta?.projects?.[0]?.issuetypes ?? []).filter((t) => !t.subtask);
      // Standard fields the toolset already covers - everything else (custom
      // fields, components, versions…) is surfaced for extraFields.
      const covered = new Set(["summary", "description", "issuetype", "project", "labels", "priority", "assignee", "reporter", "attachment"]);
      const customFields: TargetDetails["customFields"] = [];
      const seen = new Set<string>();
      for (const t of issueTypes) {
        for (const [fieldId, f] of Object.entries(t.fields ?? {})) {
          if (covered.has(fieldId) || seen.has(fieldId)) continue;
          seen.add(fieldId);
          customFields.push({
            id: fieldId,
            name: f.name ?? fieldId,
            type: f.schema?.type ?? "unknown",
            required: !!f.required,
            allowedValues: f.allowedValues?.map((v) => v.name ?? v.value ?? "").filter(Boolean).slice(0, 25),
          });
        }
      }

      return {
        id: project.id,
        key,
        name: project.name,
        description: project.description || undefined,
        states: statuses,
        labels,
        members,
        issueTypes: issueTypes.map((t) => t.name),
        customFields,
      };
    },
    async fileIssue({ targetId, title, descriptionMarkdown, labels, priority, state, assignee, comment, extraFields, evidence }) {
      // We need the project key to look up issue types and build the browse url.
      const targets = await loadTargets();
      const project = targets.find((t) => t.id === targetId || t.key === targetId);
      if (!project) throw new Error(`Jira: project ${targetId} not found`);
      const issueTypeId = await pickIssueType(project.key);

      const assigneeAccountId = assignee ? await resolveAssigneeAccountId(project.key, assignee) : undefined;

      let body = descriptionMarkdown;
      if (evidence.length) {
        // Jira can't embed images inline via the API, so the screenshots live in
        // the Attachments panel - but their descriptions belong in the body. List
        // the agent's per-screenshot captions so each one is explained.
        const imgs = evidence.filter((e) => e.contentType.startsWith("image/"));
        let shotN = 0;
        const lines = imgs.map((e) => {
          shotN += 1;
          const cap = e.caption && e.caption.trim() ? e.caption.trim() : "";
          return cap ? `- Screenshot ${shotN}: ${cap}` : `- Screenshot ${shotN}`;
        });
        const hasRec = evidence.some((e) => !e.contentType.startsWith("image/"));
        body += "\n\n## Evidence\n\n";
        if (lines.length) body += lines.join("\n") + "\n\n";
        body += hasRec
          ? "Screenshots and the screen recording are in the Attachments panel."
          : "Screenshots are in the Attachments panel.";
      }

      const baseFields: Record<string, unknown> = {
        project: { id: project.id },
        summary: title,
        issuetype: { id: issueTypeId },
        description: markdownToAdf(body),
      };
      // Preference-driven extras. Jira labels can't contain spaces; priority is
      // by standard name. Both are best-effort: if the project's create screen
      // rejects them (400), retry without so the filing never fails over them.
      const prefFields: Record<string, unknown> = {};
      if (labels?.length) {
        prefFields.labels = labels.map((l) => l.trim().replace(/\s+/g, "-")).filter(Boolean);
      }
      if (priority) {
        if (JIRA_PRIORITY[priority]) prefFields.priority = { name: JIRA_PRIORITY[priority] };
      }
      if (assigneeAccountId) prefFields.assignee = { accountId: assigneeAccountId };

      const createIssue = (fields: Record<string, unknown>) =>
        jiraFetch(tok, base, `/issue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields }),
        });

      // Raw passthrough (custom fields etc.) first - resolved fields win.
      const hasExtras = Object.keys(prefFields).length > 0 || Object.keys(extraFields ?? {}).length > 0;
      let createRes = await createIssue({ ...(extraFields ?? {}), ...baseFields, ...prefFields });
      if (!createRes.ok && hasExtras && createRes.status === 400) {
        console.warn(
          `[jira-tracker] create with extras rejected (400) - retrying without: ${await createRes.text()}`,
        );
        createRes = await createIssue(baseFields);
      }
      if (!createRes.ok) throw new Error(`Jira issue create failed: ${createRes.status} ${await createRes.text()}`);
      const created = (await createRes.json()) as { id: string; key: string };

      // Attach each evidence file to the Attachments panel.
      for (const e of evidence) {
        try {
          const form = new FormData();
          form.append(
            "file",
            new Blob([new Uint8Array(e.bytes)], { type: e.contentType }),
            e.filename
          );
          const att = await jiraFetch(tok, base, `/issue/${created.key}/attachments`, {
            method: "POST",
            headers: { "X-Atlassian-Token": "no-check" },
            body: form,
          });
          if (!att.ok) console.warn(`[jira-tracker] attachment ${e.filename} failed: ${att.status}`);
        } catch (err) {
          console.warn("[jira-tracker] attachment error:", e.filename, err);
        }
      }

      // Post the requested comment after the issue exists (best-effort).
      if (comment?.trim()) {
        try {
          const c = await jiraFetch(tok, base, `/issue/${created.key}/comment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: markdownToAdf(comment.trim()) }),
          });
          if (!c.ok) console.warn(`[jira-tracker] comment failed: ${c.status}`);
        } catch (err) {
          console.warn("[jira-tracker] comment error:", err);
        }
      }

      // Jira sets status via workflow transitions, not at create time. Apply a
      // requested state after the fact (best-effort; the agent can verify with
      // get_issue and repair with update_issue, which reports the options).
      if (state?.trim()) {
        try {
          const t = await transitionTo(created.key, state.trim());
          if (!t.ok) console.warn(`[jira-tracker] create-time transition: ${t.error}`);
        } catch (err) {
          console.warn("[jira-tracker] create-time transition error:", err);
        }
      }

      return {
        id: created.id,
        identifier: created.key,
        url: `${cloud.siteUrl}/browse/${created.key}`,
        title,
      };
    },
    async updateIssue(identifier, patch: IssuePatch): Promise<UpdateResult> {
      try {
        if (patch.project) {
          return { ok: false, error: "moving a Jira issue to another project isn't supported - file it in the right project instead" };
        }
        const fields: Record<string, unknown> = { ...(patch.extraFields ?? {}) };
        if (patch.title) fields.summary = patch.title;
        if (patch.labels?.length) fields.labels = patch.labels.map((l) => l.trim().replace(/\s+/g, "-")).filter(Boolean);
        if (patch.priority && JIRA_PRIORITY[patch.priority]) fields.priority = { name: JIRA_PRIORITY[patch.priority] };
        if (patch.assignee) {
          const projectKey = identifier.split("-")[0];
          const accountId = await resolveAssigneeAccountId(projectKey, patch.assignee);
          if (!accountId) return { ok: false, error: `no assignable user matched "${patch.assignee}" in project ${projectKey}` };
          fields.assignee = { accountId };
        }

        if (Object.keys(fields).length) {
          const r = await jiraFetch(tok, base, `/issue/${identifier}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields }),
          });
          if (!r.ok) return { ok: false, error: `Jira update failed: ${r.status} ${await r.text()}` };
        }

        if (patch.state) {
          const t = await transitionTo(identifier, patch.state);
          if (!t.ok) return t;
        }
        return { ok: true };
      } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) };
      }
    },
    async getIssue(identifier) {
      const r = await jiraFetch(
        tok,
        base,
        `/issue/${identifier}?fields=${encodeURIComponent("summary,status,assignee,labels,priority")}`,
      );
      if (!r.ok) throw new Error(`Jira issue fetch failed: ${r.status} ${await r.text()}`);
      const j = (await r.json()) as {
        key: string;
        fields?: {
          summary?: string;
          status?: { name?: string; statusCategory?: { colorName?: string } };
          assignee?: { displayName?: string };
          labels?: string[];
          priority?: { name?: string };
        };
      };
      const f = j.fields ?? {};
      return {
        identifier: j.key,
        title: f.summary ?? "",
        url: `${cloud.siteUrl}/browse/${j.key}`,
        state: f.status?.name ?? null,
        stateColor: f.status ? jiraStatusColor(f.status.statusCategory?.colorName) : null,
        assignee: f.assignee?.displayName ?? null,
        labels: f.labels ?? [],
        priority: f.priority?.name?.toLowerCase() ?? null,
      };
    },
  };
}
