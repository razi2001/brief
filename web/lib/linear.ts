import { clerkClient } from "@clerk/nextjs/server";
import type { Tracker, TrackerPriority } from "./tracker";

export type LinearTok = { token: string; kind: "oauth" | "apikey" };

export async function getLinearToken(userId: string): Promise<LinearTok | null> {
  // Productized path: Clerk-vended OAuth token for the Linear connected account.
  const client = await clerkClient().catch(() => null);
  if (client) {
    try {
      const res = await client.users.getUserOauthAccessToken(userId, "oauth_linear");
      const t = res.data?.[0]?.token;
      if (t) return { token: t, kind: "oauth" };
    } catch { /* not connected / shared creds — fall through */ }
  }
  // Testing fallback: personal API key.
  const key = process.env.LINEAR_API_KEY;
  if (key) return { token: key, kind: "apikey" };
  return null;
}

function authHeader(tok: LinearTok): string {
  return tok.kind === "oauth" ? `Bearer ${tok.token}` : tok.token;
}

const AUTH_EXPIRED =
  "Your Linear connection has expired — reconnect Linear under Connections, then retry.";

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
 * Builds ONE aliased GraphQL query (i0/i1/…) for up to ~20 ids in a single
 * round-trip and parses the result into a map keyed by identifier.
 *
 * Defensive by design: de-dupes ids, caps at 20, and wraps the whole thing in
 * try/catch returning {} on ANY failure — a Linear outage or token problem must
 * never break the dashboard render.
 */
export async function getIssuesByIdentifiers(
  tok: LinearTok,
  identifiers: string[],
): Promise<Record<string, LinearIssueInfo>> {
  try {
    const ids = Array.from(new Set(identifiers.filter(Boolean))).slice(0, 20);
    if (ids.length === 0) return {};

    const fields =
      "identifier title url createdAt state { name color type } assignee { name avatarUrl }";
    const aliases = ids
      .map((id, i) => `i${i}: issue(id: ${JSON.stringify(id)}) { ${fields} }`)
      .join("\n");
    const query = `query IssuesByIdentifier {\n${aliases}\n}`;

    const data = await linearGraphQL<Record<string, any>>(tok, query, {});
    const out: Record<string, LinearIssueInfo> = {};
    for (let i = 0; i < ids.length; i++) {
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
    return out;
  } catch {
    return {};
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
  }): Promise<{ id: string; identifier: string; url: string; title: string }>;
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

  return {
    kind: "linear",
    targetNoun: "team",
    async listTargets() {
      // Include each team's labels/states so the agent can apply the user's
      // ticket preferences (e.g. "label every ticket inbound", "status Backlog")
      // with real names instead of guessing.
      const d = await loadTeamMeta();
      return [...d.entries()].map(([id, meta]) => ({
        id,
        key: meta.key,
        name: meta.name,
        labels: meta.labels.map((l) => l.name),
        states: meta.states.map((s) => s.name),
      }));
    },
    async fileIssue({ targetId, title, descriptionMarkdown, labels, priority, state, evidence }) {
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
            // Recording: a bare URL on its own line is enough — Linear renders it
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

      // Resolve the agent's label/state names to ids — best-effort, never fatal.
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
            // ("label every ticket inbound") — create it on the team so the
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

      const issue = await api.createIssue({
        teamId: targetId,
        title,
        description,
        ...(labelIds ? { labelIds } : {}),
        ...(priority && LINEAR_PRIORITY[priority] ? { priority: LINEAR_PRIORITY[priority] } : {}),
        ...(stateId ? { stateId } : {}),
      });
      return { id: issue.id, identifier: issue.identifier, url: issue.url, title: issue.title };
    },
  };
}
