// Pure helpers for the ticket snapshot sync (persisted last-known title/state
// of a filed ticket). Kept free of server-only imports so they're unit-testable.

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
};

export type LiveTicket = { title: string; stateName: string; stateColor: string };

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
  return Object.keys(patch).length ? patch : null;
}
