import { clerkClient } from "@clerk/nextjs/server";
import type { Tracker } from "./tracker";

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

export async function linearGraphQL<T = any>(tok: LinearTok, query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader(tok) },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error("Linear GraphQL: " + JSON.stringify(j.errors));
  return j.data as T;
}

export interface LinearApi {
  listTeams(): Promise<Array<{ id: string; name: string; key: string }>>;
  createIssue(input: { teamId: string; title: string; description: string }): Promise<{ id: string; identifier: string; url: string; title: string }>;
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

// Provider-agnostic adapter. Reuses makeLinearApi's upload+embed behaviour so
// Linear tickets keep their inline images.
export function makeLinearTracker(tok: LinearTok): Tracker {
  const api = makeLinearApi(tok);
  return {
    kind: "linear",
    targetNoun: "team",
    async listTargets() {
      const teams = await api.listTeams();
      return teams.map((t) => ({ id: t.id, key: t.key, name: t.name }));
    },
    async fileIssue({ targetId, title, descriptionMarkdown, evidence }) {
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
            // Recording: bare URL auto-embeds an inline player + a labelled link.
            embeds.push(`**Screen recording:**\n\n${assetUrl}\n\n[Open recording](${assetUrl})`);
          }
        } catch (err) {
          console.warn("[linear-tracker] evidence upload failed:", e.filename, err);
        }
      }
      // Append the Evidence section only if the description doesn't already carry hosted assets.
      if (embeds.length && !description.includes("uploads.linear.app")) {
        description += "\n\n## Evidence\n\n" + embeds.join("\n\n");
      }
      const issue = await api.createIssue({ teamId: targetId, title, description });
      return { id: issue.id, identifier: issue.identifier, url: issue.url, title: issue.title };
    },
  };
}
