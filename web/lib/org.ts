/**
 * Org identity: pure key handling.
 *
 * An org in Brief is a TRACKER WORKSPACE. Two users are in the same org when
 * their connected tracker points at the same place - the same Linear
 * organization, the same Jira site, the same GitHub org. Nothing is invited or
 * administered; membership is a fact about the token, proven server-side (the
 * resolution itself lives in org-server.ts).
 *
 * Keys are `provider:id` so one column can hold an org from any tracker and two
 * providers can never collide on a shared id.
 */

import type { ProviderKey } from "@/lib/tracker";

/**
 * Build an org key, or null when the id is blank.
 *
 * A blank id would produce a key like "linear:" that every user with a broken
 * lookup would share - which is exactly the bug that would leak one workspace's
 * leaderboard into another's. No id, no org.
 */
export function orgKey(provider: ProviderKey, id: string): string | null {
  const trimmed = (id ?? "").trim();
  if (!trimmed) return null;
  // GitHub org logins are case-insensitive upstream, so "Acme" and "acme" are
  // one org and must produce one key. Linear and Jira ids are opaque and
  // case-sensitive - normalizing those would merge distinct workspaces.
  const normalized = provider === "github" ? trimmed.toLowerCase() : trimmed;
  return `${provider}:${normalized}`;
}
