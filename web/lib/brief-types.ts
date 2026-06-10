/** Provider-agnostic live ticket info, merged server-side when synced. Covers
 *  both Linear (which can also carry an assignee) and Jira. */
export type TicketInfo = {
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
  source_kind?: string | null;
  created_at?: string | null;
  /** When the brief last changed state — used to time "filing…" elapsed. */
  updated_at?: string | null;
  ticket_url?: string | null;
  ticket_identifier?: string | null;
  error?: string | null;
  /** Which tracker this brief was filed to (inferred from ticket_url). */
  provider?: "linear" | "jira";
  /** Live ticket info (Linear or Jira), merged server-side when synced. */
  ticket?: TicketInfo | null;
};
