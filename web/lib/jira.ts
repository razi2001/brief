import { clerkClient } from "@clerk/nextjs/server";
import type { Tracker, TrackerTarget } from "./tracker";
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
// Tracker implementation
// ---------------------------------------------------------------------------

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

  return {
    kind: "jira",
    targetNoun: "project",
    async listTargets(): Promise<TrackerTarget[]> {
      const out: TrackerTarget[] = [];
      let startAt = 0;
      // /project/search is paginated.
      for (;;) {
        const r = await jiraFetch(tok, base, `/project/search?startAt=${startAt}&maxResults=50`);
        if (!r.ok) throw new Error(`Jira project/search failed: ${r.status} ${await r.text()}`);
        const j = (await r.json()) as {
          values?: Array<{ id: string; key: string; name: string }>;
          isLast?: boolean;
          total?: number;
        };
        for (const p of j.values ?? []) out.push({ id: p.id, key: p.key, name: p.name });
        if (j.isLast || !(j.values?.length)) break;
        startAt += j.values.length;
        if (out.length >= (j.total ?? out.length)) break;
      }
      return out;
    },
    async fileIssue({ targetId, title, descriptionMarkdown, labels, priority, assignee, comment, evidence }) {
      // We need the project key to look up issue types and build the browse url.
      const targets = await this.listTargets();
      const project = targets.find((t) => t.id === targetId || t.key === targetId);
      if (!project) throw new Error(`Jira: project ${targetId} not found`);
      const issueTypeId = await pickIssueType(project.key);

      // Resolve the assignee to a Jira accountId (best-effort, never fatal).
      async function resolveAssigneeAccountId(want: string): Promise<string | undefined> {
        try {
          const r = await jiraFetch(
            tok,
            base,
            `/user/assignable/search?project=${encodeURIComponent(project!.key)}&query=${encodeURIComponent(want)}&maxResults=1`,
          );
          if (!r.ok) return undefined;
          const users = (await r.json()) as Array<{ accountId: string }>;
          return users?.[0]?.accountId;
        } catch {
          return undefined;
        }
      }
      const assigneeAccountId = assignee ? await resolveAssigneeAccountId(assignee) : undefined;

      let body = descriptionMarkdown;
      if (evidence.length) {
        const names = evidence.map((e) => e.filename).join(", ");
        body += `\n\nEvidence attached: ${names} (see the Attachments panel).`;
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
      const extraFields: Record<string, unknown> = {};
      if (labels?.length) {
        extraFields.labels = labels.map((l) => l.trim().replace(/\s+/g, "-")).filter(Boolean);
      }
      if (priority) {
        const JIRA_PRIORITY: Record<string, string> = {
          urgent: "Highest",
          high: "High",
          medium: "Medium",
          low: "Low",
        };
        if (JIRA_PRIORITY[priority]) extraFields.priority = { name: JIRA_PRIORITY[priority] };
      }
      if (assigneeAccountId) extraFields.assignee = { accountId: assigneeAccountId };

      const createIssue = (fields: Record<string, unknown>) =>
        jiraFetch(tok, base, `/issue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields }),
        });

      const hasExtras = Object.keys(extraFields).length > 0;
      let createRes = await createIssue({ ...baseFields, ...extraFields });
      if (!createRes.ok && hasExtras && createRes.status === 400) {
        console.warn(
          `[jira-tracker] create with labels/priority rejected (400) - retrying without: ${await createRes.text()}`,
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

      return {
        id: created.id,
        identifier: created.key,
        url: `${cloud.siteUrl}/browse/${created.key}`,
        title,
      };
    },
  };
}
