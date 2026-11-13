import type { ProviderKey } from "./tracker";

/** Provider-agnostic live ticket info, merged server-side when synced. Every
 *  adapter produces this shape, whatever its own API looks like. */
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
  /** Which tracker this brief was filed to (the recorded ticket_provider,
   *  falling back to the ticket_url's hostname on older rows). */
  provider?: ProviderKey;
  /** It is a draft: written up (or being written up) and never filed. Set by
   *  the Tickets page, which lists drafts beside tickets. */
  draft?: boolean;
  /** Live ticket info from whichever tracker it lives in, merged server-side. */
  ticket?: TicketInfo | null;
};
