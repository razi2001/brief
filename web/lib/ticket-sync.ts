// Pure helpers for the ticket snapshot sync (persisted last-known title/state
// of a filed ticket). Kept free of server-only imports so they're unit-testable.

import type { ProviderKey } from "./tracker";
import { PROVIDER_LABELS } from "./provider-labels";

/** Every ProviderKey, as a runtime list, for validating a stored value. */
export const PROVIDER_KEYS: ProviderKey[] = [
  "linear",
  "jira",
  "github",
  "gitlab",
  "azure",
  "clickup",
  "notion",
  "trello",
  "asana",
  "monday",
];

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
  ["gitlab", /(^|\.)gitlab\.com$/],
  // Current organization URLs, and the visualstudio.com ones that predate them.
  ["azure", /(^|\.)dev\.azure\.com$|\.visualstudio\.com$/],
  ["clickup", /(^|\.)clickup\.com$/],
  ["notion", /(^|\.)notion\.(so|site)$/],
  ["trello", /(^|\.)trello\.com$/],
  ["asana", /(^|\.)asana\.com$/],
  ["monday", /(^|\.)monday\.com$/],
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
 * The identifier as a reader should see it where there is room (the brief
 * page's meta row), or "" when it has no form a reader would recognise.
 * Callers render nothing for "": no empty chip, no stray separator.
 *
 * Notion and Asana have no human key at all: the identifier is a page id or a
 * task gid, which means nothing to a reader. Monday's is a bare item number,
 * which reads as one with a "#". Every other tracker's identifier is already
 * what its own UI shows.
 */
export function displayIdentifier(identifier?: string | null, provider?: ProviderKey): string {
  const id = (identifier ?? "").trim();
  if (!id) return "";
  if (provider === "notion" || provider === "asana") return "";
  if (provider === "monday" && /^\d+$/.test(id)) return `#${id}`;
  return id;
}

/**
 * What an id slot shows for a ticket with no readable identifier: the
 * tracker's own name ("Notion", "Asana"), so the slot never reads as a logo
 * beside nothing. "" when the ticket has an identifier a reader would
 * recognise (show that instead), and when there is no ticket at all. The raw
 * page id or task gid is never the answer.
 */
export function keylessTrackerName(identifier?: string | null, provider?: ProviderKey): string {
  if (!provider || !(identifier ?? "").trim()) return "";
  if (displayIdentifier(identifier, provider)) return "";
  return PROVIDER_LABELS[provider] ?? "";
}

/**
 * The identifier as it should READ in a narrow column: displayIdentifier,
 * shortened where the tracker qualifies its numbers.
 *
 * Linear and Jira identifiers are already short ("ENG-42", "PROJ-7"). GitHub's
 * has to be fully qualified - issue numbers are only unique per repository - so
 * it arrives as "owner/repo#123", which truncates to the owner and tells the
 * reader nothing: every ticket in a workspace looks identical. The owner is the
 * least informative part, so it is what gets dropped. GitLab's is the same
 * shape with any depth of groups ("group/sub/project#12"), and keeps only the
 * project. Azure DevOps names the project in full ("Project Name#42"), which
 * has nothing to drop but is clipped the same way when it is too long.
 *
 * The full identifier stays available for the link title.
 */
export function shortIdentifier(
  identifier?: string | null,
  provider?: ProviderKey,
  maxLength = 18,
): string {
  const id = displayIdentifier(identifier, provider);
  if (!id) return "";

  if (provider === "azure") {
    const m = /^([^#]+)(#\d+)$/.exec(id);
    return m ? keepNumber(m[1], m[2], maxLength) : id;
  }
  if (provider !== "github" && provider !== "gitlab") return id;

  // Everything up to the last "/" is the owner or group path; the last
  // segment is the repository or project.
  const m = /^(?:[^/\s]+\/)+([^/#\s]+)(#\d+)$/.exec(id);
  return m ? keepNumber(m[1], m[2], maxLength) : id;
}

/** `name` + `number`, with the NAME clipped when the pair is too long. */
function keepNumber(name: string, number: string, maxLength: number): string {
  const short = `${name}${number}`;
  if (short.length <= maxLength) return short;

  // Still too long for the column. Trim the NAME and keep the number: the
  // number is what distinguishes two tickets in the same repository, so
  // clipping it (which plain CSS truncation does) makes every row identical.
  // A project name with spaces must not leave one dangling before the "…".
  const room = Math.max(1, maxLength - number.length - 1);
  return `${name.slice(0, room).trimEnd()}…${number}`;
}
