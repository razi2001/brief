// Pure helpers for the ticket snapshot sync (persisted last-known title/state
// of a filed ticket). Kept free of server-only imports so they're unit-testable.

import type { ProviderKey } from "./tracker";

/** Every ProviderKey, as a runtime list, for validating a stored value. */
export const PROVIDER_KEYS: ProviderKey[] = ["linear", "jira", "github"];

/**
 * Which tracker a filed brief went to.
 *
 * `stored` (the briefs.ticket_provider column, written at filing time) is the
 * truth when present. Hostname inference is only the fallback for rows filed
 * before that column existed - it cannot be relied on in general, because a
 * self-hosted instance can live on any domain at all.
 *
 * The hostname is the ONLY part of the URL consulted: Linear puts the ticket
 * title in the URL slug, so a ticket *about* Jira
 * (".../issue/RAZ-181/...-after-switching-to-jira") must not be misread as a
 * Jira ticket. Each pattern below is matched against the host alone.
 */
const HOST_PATTERNS: Array<[ProviderKey, RegExp]> = [
  ["jira", /(^|\.)atlassian\.(net|com)$|(^|\.)jira\./],
  ["linear", /(^|\.)linear\.app$/],
  ["github", /(^|\.)github\.com$/],
];

export function providerOf(url?: string | null, stored?: string | null): ProviderKey {
  const s = (stored ?? "").trim();
  if (s && PROVIDER_KEYS.includes(s as ProviderKey)) return s as ProviderKey;
  try {
    const host = new URL(url ?? "").hostname.toLowerCase();
    for (const [key, re] of HOST_PATTERNS) if (re.test(host)) return key;
  } catch {
    /* not a url - fall through */
  }
  // Linear was the original and only provider, so an unrecognizable url on a
  // row with no stored provider is almost certainly one of those.
  return "linear";
}

/** Split a list into consecutive chunks of at most `size` items. */
export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export type TicketSnapshotRow = {
  ticket_title: string | null;
  ticket_state_name: string | null;
  ticket_state_color: string | null;
  /** Where the ticket lives. Follows the ticket when it's moved to another team. */
  ticket_identifier?: string | null;
  ticket_url?: string | null;
};

export type LiveTicket = {
  title: string;
  stateName: string;
  stateColor: string;
  /** The tracker's CURRENT identifier/url, when the provider reports them. */
  identifier?: string;
  url?: string;
};

/**
 * Diff the live tracker info against the stored snapshot. Returns a minimal
 * update patch, or null when nothing (non-empty) changed. Empty live values
 * never clobber a stored one - a degraded fetch must not erase the snapshot.
 */
export function ticketSnapshotPatch(
  row: TicketSnapshotRow,
  live: LiveTicket,
): Partial<TicketSnapshotRow> | null {
  const patch: Partial<TicketSnapshotRow> = {};
  if (live.title && live.title !== row.ticket_title) patch.ticket_title = live.title;
  if (live.stateName && live.stateName !== row.ticket_state_name)
    patch.ticket_state_name = live.stateName;
  if (live.stateColor && live.stateColor !== row.ticket_state_color)
    patch.ticket_state_color = live.stateColor;
  // A ticket moved to another team gets a new identifier (and url). Keep the
  // row pointing at where it lives now, or the next sync asks for a ghost.
  if (live.identifier && live.identifier !== row.ticket_identifier)
    patch.ticket_identifier = live.identifier;
  if (live.url && live.url !== row.ticket_url) patch.ticket_url = live.url;
  return Object.keys(patch).length ? patch : null;
}

/**
 * The identifier as it should READ in a narrow column.
 *
 * Linear and Jira identifiers are already short ("ENG-42", "PROJ-7"). GitHub's
 * has to be fully qualified - issue numbers are only unique per repository - so
 * it arrives as "owner/repo#123", which truncates to the owner and tells the
 * reader nothing: every ticket in a workspace looks identical. The owner is the
 * least informative part, so it is what gets dropped.
 *
 * The full identifier stays available for the link title.
 */
export function shortIdentifier(
  identifier?: string | null,
  provider?: ProviderKey,
  maxLength = 18,
): string {
  const id = (identifier ?? "").trim();
  if (!id) return "";
  if (provider !== "github") return id;

  const m = /^[^/\s]+\/([^#\s]+)(#\d+)$/.exec(id);
  if (!m) return id;
  const [, repo, number] = m;
  const short = `${repo}${number}`;
  if (short.length <= maxLength) return short;

  // Still too long for the column. Trim the REPO and keep the number: the
  // number is what distinguishes two tickets in the same repository, so
  // clipping it (which plain CSS truncation does) makes every row identical.
  const room = Math.max(1, maxLength - number.length - 1);
  return `${repo.slice(0, room)}…${number}`;
}
