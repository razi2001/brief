import FreshOnReturn from "@/components/FreshOnReturn";
import RequestsView from "@/components/RequestsView";
import { requireUserId } from "@/lib/auth";
import { loadRequests } from "@/lib/requests-server";

/** Feature requests: everyone sends and upvotes, the owner sets the status. */
export default async function RequestsPage() {
  const userId = await requireUserId();
  const { items, admin } = await loadRequests(userId);
  return (
    <>
      <FreshOnReturn renderId={crypto.randomUUID()} />
      <RequestsView initial={items} admin={admin} />
    </>
  );
}
