// Pure helpers for the ticket snapshot sync (persisted last-known title/state
// of a filed ticket). Kept free of server-only imports so they're unit-testable.

/**
 * Infer the tracker a filed brief went to from its ticket URL. Decided by the
 * HOSTNAME only - Linear puts the ticket title in the URL slug, so a ticket
 * *about* Jira (".../issue/RAZ-181/...-after-switching-to-jira") must not be
 * misread as a Jira ticket.
 */
export function providerOf(url?: string | null): "linear" | "jira" {
  try {
    const host = new URL(url ?? "").hostname.toLowerCase();
    return host.includes("atlassian") || host.includes("jira") ? "jira" : "linear";
  } catch {
    return "linear";
  }
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
