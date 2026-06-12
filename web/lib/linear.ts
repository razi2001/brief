import { clerkClient } from "@clerk/nextjs/server";
import type { Tracker, TrackerPriority } from "./tracker";
import { chunk } from "./ticket-sync";

export type LinearTok = { token: string };

export async function getLinearToken(userId: string): Promise<LinearTok | null> {
  // Clerk-vended OAuth token for the user's connected Linear account - the only
  // path. No global API-key fallback: a user who hasn't connected Linear has no
  // token, so the app honestly reports "no tracker connected" instead of
  // silently filing through a shared key.
  const client = await clerkClient().catch(() => null);
  if (!client) return null;
  try {
    const res = await client.users.getUserOauthAccessToken(userId, "oauth_linear");
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
  "Your Linear connection has expired - reconnect Linear under Connections, then retry.";

export async function linearGraphQL<T = any>(tok: LinearTok, query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader(tok) },
    body: JSON.stringify({ query, variables }),
  });
  // Expired / revoked OAuth token → tell the user to reconnect, not a raw 401/403.
  if (r.status === 401 || r.status === 403) throw new Error(AUTH_EXPIRED);
  const j = await r.json().catch(() => ({}) as any);
  if (j.errors) {
    const msg = JSON.stringify(j.errors);
    if (/authentication|unauthenticated|unauthorized|forbidden|access token|invalid token/i.test(msg)) {
      throw new Error(AUTH_EXPIRED);
    }
    throw new Error("Linear GraphQL: " + msg);
  }
  return j.data as T;
}

export interface LinearIssueInfo {
  identifier: string;
  title: string;
  url: string;
  stateName: string;
  stateColor: string;
  stateType: string;
  createdAt: string;
  assignee?: { name: string; avatarUrl?: string };
}

/**
 * Fetch live Linear issue info for a set of issue identifiers (e.g. "RAZ-153").
 * Builds aliased GraphQL queries (i0/i1/…) of up to 20 ids per round-trip -
 * larger sets are CHUNKED into several queries instead of silently dropped.
 *
 * Defensive by design: de-dupes ids and wraps the whole thing in try/catch
 * returning what it has on ANY failure - a Linear outage or token problem must
 * never break the dashboard render.
 */
export async function getIssuesByIdentifiers(
  tok: LinearTok,
  identifiers: string[],
): Promise<Record<string, LinearIssueInfo>> {
  const out: Record<string, LinearIssueInfo> = {};
  try {
    const ids = Array.from(new Set(identifiers.filter(Boolean)));
    if (ids.length === 0) return out;

    const fields =
      "identifier title url createdAt state { name color type } assignee { name avatarUrl }";
    for (const batch of chunk(ids, 20)) {
      const aliases = batch
        .map((id, i) => `i${i}: issue(id: ${JSON.stringify(id)}) { ${fields} }`)
        .join("\n");
      const query = `query IssuesByIdentifier {\n${aliases}\n}`;

      const data = await linearGraphQL<Record<string, any>>(tok, query, {});
      for (let i = 0; i < batch.length; i++) {
        const node = data?.[`i${i}`];
        if (!node?.identifier) continue;
        out[node.identifier] = {
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
    }
    return out;
  } catch {
    return out;
  }
}

export interface LinearApi {
  listTeams(): Promise<Array<{ id: string; name: string; key: string }>>;
  createIssue(input: {
    teamId: string;
    title: string;
    description: string;
    labelIds?: string[];
    priority?: number;
    stateId?: string;
    assigneeId?: string;
  }): Promise<{ id: string; identifier: string; url: string; title: string }>;
  // Post a comment on an existing issue (markdown body).
  createComment(issueId: string, body: string): Promise<void>;
  // Upload a file to Linear's asset storage and return its public asset URL.
  uploadAsset(input: { filename: string; contentType: string; bytes: Buffer }): Promise<string>;
}

export function makeLinearApi(tok: LinearTok): LinearApi {
  return {
    async listTeams() {
      const d = await linearGraphQL<{ teams: { nodes: any[] } }>(tok, `query { teams { nodes { id name key } } }`, {});
      return d.teams.nodes;
    },
    async createIssue(input) {
      const d = await linearGraphQL<{ issueCreate: { success: boolean; issue: any } }>(
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

/** Linear numeric priority for our normalized names (0 = none). */
const LINEAR_PRIORITY: Record<TrackerPriority, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

type TeamMeta = {
  name: string;
  key: string;
  states: Array<{ id: string; name: string }>;
  labels: Array<{ id: string; name: string }>; // workspace + this team's labels
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
      teams: { nodes: Array<{ id: string; name: string; key: string; states: { nodes: Array<{ id: string; name: string }> }; labels: { nodes: Array<{ id: string; name: string }> } }> };
      issueLabels: { nodes: Array<{ id: string; name: string; team: { id: string } | null }> };
    }>(
      tok,
      `query TeamsWithMeta {
        teams { nodes { id name key states { nodes { id name } } labels { nodes { id name } } } }
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
          states: t.states?.nodes ?? [],
          labels: [...workspaceLabels, ...(t.labels?.nodes ?? [])],
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

  return {
    kind: "linear",
    targetNoun: "team",
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
        labels: meta.labels.map((l) => l.name),
        states: meta.states.map((s) => s.name),
        assignees,
      }));
    },
    async fileIssue({ targetId, title, descriptionMarkdown, labels, priority, state, assignee, comment, evidence }) {
      let description = descriptionMarkdown;
      // Upload each evidence file and embed it inline (Linear-hosted asset URL).
      const embeds: string[] = [];
      let imgN = 0;
      for (const e of evidence) {
        try {
          const assetUrl = await api.uploadAsset({ filename: e.filename, contentType: e.contentType, bytes: e.bytes });
          if (e.contentType.startsWith("image/")) {
            imgN += 1;
            // Human caption, never the raw filename.
            embeds.push(`![Screenshot ${imgN}](${assetUrl})`);
          } else {
            // Recording: a bare URL on its own line is enough - Linear renders it
            // as an inline player with its own link. Don't add a second link (that
            // made the recording show up "twice").
            embeds.push(`**Screen recording:**\n\n${assetUrl}`);
          }
        } catch (err) {
          console.warn("[linear-tracker] evidence upload failed:", e.filename, err);
        }
      }
      // Append the Evidence section only if the description doesn't already carry hosted assets.
      if (embeds.length && !description.includes("uploads.linear.app")) {
        description += "\n\n## Evidence\n\n" + embeds.join("\n\n");
      }

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
          stateId = meta.states.find((s) => norm(s.name) === norm(state))?.id;
        }
      } catch (err) {
        console.warn("[linear-tracker] label/state resolution failed:", err);
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
        teamId: targetId,
        title,
        description,
        ...(labelIds ? { labelIds } : {}),
        ...(priority && LINEAR_PRIORITY[priority] ? { priority: LINEAR_PRIORITY[priority] } : {}),
        ...(stateId ? { stateId } : {}),
        ...(assigneeId ? { assigneeId } : {}),
      });

      // Post the requested comment after the issue exists (best-effort).
      if (comment?.trim()) {
        try {
          await api.createComment(issue.id, comment.trim());
        } catch (err) {
          console.warn("[linear-tracker] comment post failed:", err);
        }
      }

      return { id: issue.id, identifier: issue.identifier, url: issue.url, title: issue.title };
    },
  };
}
