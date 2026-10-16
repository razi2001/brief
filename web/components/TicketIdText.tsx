import { keylessTrackerName, shortIdentifier } from "@/lib/ticket-sync";
import type { ProviderKey } from "@/lib/tracker";

/**
 * The words beside a filed ticket's tracker logo in a list: its short
 * identifier, or, for a tracker with no readable one (a Notion page, an Asana
 * task), the tracker's name in plain muted text. Never the raw page id.
 * Renders nothing when there is no ticket identifier at all.
 */
export default function TicketIdText({
  identifier,
  provider,
}: {
  identifier?: string | null;
  provider?: ProviderKey;
}) {
  const shortId = shortIdentifier(identifier, provider);
  if (shortId) return <span className="truncate">{shortId}</span>;
  const name = keylessTrackerName(identifier, provider);
  return name ? <span className="truncate font-sans text-muted">{name}</span> : null;
}
