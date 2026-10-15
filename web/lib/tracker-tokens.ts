// Tokens for Linear, Jira and GitHub during their move off Clerk.
//
// These three used to be Clerk connected accounts and are now connected
// through Brief's own OAuth like every other tracker (lib/connections). Nobody
// is made to reconnect: someone who connected one through Clerk keeps filing on
// that Clerk token. So each token here comes from Brief's store first and from
// Clerk second, and a Brief connect removes the Clerk account it replaces.
// Once no user has a Clerk tracker account left, the Clerk half of each goes
// (TRACKERS.md, "Cleanup after migration").
//
// Clerk is asked only when Brief holds no row at all. A row that can't be used
// (a refused refresh, a store outage) makes the tracker stale instead: the
// user moved to Brief, and a Clerk token left behind could belong to another
// account and file into another workspace than the one their org comes from.

import { metaWorkspace, readConnection } from "@/lib/connections";
import { getLinearToken, type LinearTok } from "@/lib/linear";
import { getGithubToken, type GithubTok } from "@/lib/github";
import { getJiraAuth, getJiraCloud, type JiraTok } from "@/lib/jira";

/** The three trackers that can still be on a Clerk connected account. */
export type MovedProvider = "linear" | "jira" | "github";

export async function linearToken(userId: string): Promise<LinearTok | null> {
  const read = await readConnection(userId, "linear");
  if (read.state === "connected") return { token: read.connection.accessToken };
  return read.state === "absent" ? getLinearToken(userId) : null;
}

export async function githubToken(userId: string): Promise<GithubTok | null> {
  const read = await readConnection(userId, "github");
  if (read.state === "connected") return { token: read.connection.accessToken };
  return read.state === "absent" ? getGithubToken(userId) : null;
}

/** A Jira site, as every Jira call addresses it. */
export type JiraCloud = { cloudId: string; siteUrl: string; name?: string };

/**
 * The site a Brief-held Jira connection was pinned to, from its account_meta,
 * or null before one is picked. The pick stores the site's address beside its
 * id, since browse links and the basic-auth path are built from it.
 */
export function jiraSite(meta: Record<string, string>): JiraCloud | null {
  const ws = metaWorkspace(meta);
  const siteUrl = meta.siteUrl;
  return ws && siteUrl ? { cloudId: ws.id, siteUrl, name: ws.name } : null;
}

/**
 * Where this user's Jira calls go. A Brief-held connection files into the site
 * the user picked, and says "needsSite" until there is one. With no Brief row
 * at all, the Clerk account from before the move files into its token's first
 * site, as it always has, and the JIRA_API_TOKEN test account into JIRA_SITE.
 */
export async function jiraAccess(
  userId: string,
): Promise<{ tok: JiraTok; cloud: JiraCloud } | "needsSite" | null> {
  const read = await readConnection(userId, "jira");
  if (read.state === "connected") {
    const cloud = jiraSite(read.connection.meta);
    return cloud ? { tok: { token: read.connection.accessToken, kind: "oauth" }, cloud } : "needsSite";
  }
  if (read.state === "unusable") return null;
  const tok = await getJiraAuth(userId);
  if (!tok) return null;
  const cloud = await getJiraCloud(tok);
  return cloud ? { tok, cloud } : null;
}
