import FeedPage from "@/components/FeedPage";
import { parseTagParam } from "@/lib/tags";

/**
 * Tickets and drafts, or one folder of them: /tickets?tag=<tag id>, or
 * ?tag=none for what has no tag. ?show=drafts opens on the Drafts tab.
 */
export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ tag?: string | string[]; show?: string | string[] }> }) {
  const { tag, show } = await searchParams;
  return <FeedPage tag={parseTagParam(tag)} show={show === "drafts" ? "drafts" : null} />;
}
