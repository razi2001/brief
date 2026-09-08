/** Provider-agnostic live ticket info, merged server-side when synced. Covers
 *  both Linear (which can also carry an assignee) and Jira. */
export type TicketInfo = {
  /** The ticket's CURRENT identifier - differs from the brief's stored
   *  ticket_identifier once the ticket was moved to another team. */
  identifier?: string;
  /** The tracker no longer has this ticket (deleted there). Its status reads
   *  "Deleted" and the row stops linking into the tracker. */
  deleted?: boolean;
  title: string;
  url: string;
  stateName: string;
  stateColor: string;
  createdAt: string;
  assignee?: { name: string; avatarUrl?: string };
};

/** A brief as rendered in the Briefs feed / Dashboard, with live ticket info
 *  merged in where available. */
export type DashboardBrief = {
  id: string;
  status: string;
  /** User-given brief name, shown while the ticket is still filing. */
  title?: string | null;
  /** True when the brief has been archived (hidden unless "Show archived"). */
  archived?: boolean;
  source_kind?: string | null;
  created_at?: string | null;
  /** When the brief last changed state - used to time "filing…" elapsed. */
  updated_at?: string | null;
  ticket_url?: string | null;
  ticket_identifier?: string | null;
  /** Agent-written ticket title (snapshot) - shown for drafts in the feed,
   *  which have no live tracker ticket to read a title from. */
  ticket_title?: string | null;
  /** Unguessable token for the public shareable brief page (/b/<share_id>). */
  share_id?: string | null;
  /** Per-user sequential number, shown as "brief-N" for briefs with no tracker id. */
  seq?: number | null;
  error?: string | null;
  /** Which tracker this brief was filed to (inferred from ticket_url). */
  provider?: "linear" | "jira";
  /** Live ticket info (Linear or Jira), merged server-side when synced. */
  ticket?: TicketInfo | null;
};
