/**
 * Org membership inferred from filing history.
 *
 * Resolving an org needs a live tracker token, and plenty of accounts can't
 * produce one: Clerk holds a Linear connection it reports as verified but
 * refuses to vend a token for, because the underlying grant went stale. Those
 * people disappear from their own team's roster until they reconnect - even
 * when they have filed dozens of tickets into that very workspace.
 *
 * But we already hold the evidence. Brief filed those tickets itself, using
 * that person's token at the time, and recorded the resulting URL. A Linear
 * issue url names its workspace, so if someone's tickets went to the same
 * workspace a confirmed member files into, they were in that workspace.
 *
 * This is weaker than a live token, so it is a FALLBACK only - never used for
 * someone whose own token already answered. It also can't be forged: the only
 * way to get a ticket url for a workspace is to have successfully filed into
 * it through Brief, which required a valid token at the time.
 */

export type ResolvedOrg = { orgKey: string; orgName: string };
export type TicketRef = { userId: string; url: string | null };
export type InferredMembership = { userId: string; orgKey: string; orgName: string };

/** The workspace segment of a Linear issue url, lowercased. Null for anything else. */
export function workspaceSlug(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^https?:\/\/linear\.app\/([^/?#]+)/i.exec(url.trim());
  const slug = m?.[1]?.toLowerCase();
  return slug ? slug : null;
}

export function inferMemberships(input: {
  tickets: TicketRef[];
  /** Everyone whose org is already known from their own token. */
  resolved: Map<string, ResolvedOrg>;
}): InferredMembership[] {
  // Which org each workspace belongs to, learned from confirmed members.
  const orgBySlug = new Map<string, ResolvedOrg | null>();
  for (const t of input.tickets) {
    const known = input.resolved.get(t.userId);
    const slug = workspaceSlug(t.url);
    // Linear workspaces only ever teach us about Linear orgs. Someone resolved
    // through Jira can still file Linear tickets, and sharing their Linear
    // workspace says nothing about sharing their Jira site.
    if (!known || !slug || !known.orgKey.startsWith("linear:")) continue;
    const seen = orgBySlug.get(slug);
    if (seen === undefined) {
      orgBySlug.set(slug, known);
    } else if (seen && seen.orgKey !== known.orgKey) {
      // Two confirmed members disagree about what this workspace is. Rather
      // than pick one, refuse to place anybody through it.
      orgBySlug.set(slug, null);
    }
  }

  // How often each unresolved person files into each workspace.
  const counts = new Map<string, Map<string, number>>();
  for (const t of input.tickets) {
    if (input.resolved.has(t.userId)) continue;
    const slug = workspaceSlug(t.url);
    if (!slug || !orgBySlug.get(slug)) continue;
    const perUser = counts.get(t.userId) ?? new Map<string, number>();
    perUser.set(slug, (perUser.get(slug) ?? 0) + 1);
    counts.set(t.userId, perUser);
  }

  const out: InferredMembership[] = [];
  for (const [userId, perUser] of counts) {
    // Someone may have filed into several workspaces; the one they use most is
    // the one that represents their team.
    const [bestSlug] = [...perUser.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0];
    const org = orgBySlug.get(bestSlug);
    if (org) out.push({ userId, orgKey: org.orgKey, orgName: org.orgName });
  }
  return out;
}
