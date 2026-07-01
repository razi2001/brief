import { requireUserId } from "@/lib/auth";
import IntegrationsClient from "@/components/IntegrationsClient";
import TicketPreferences from "@/components/TicketPreferences";
import { getTrackerContext } from "@/lib/briefs-server";

export default async function ConnectionsPage() {
  await requireUserId();
  const ctx = await getTrackerContext();

  return (
    // The app shell is wide (for the tickets table); forms read better narrow,
    // so clamp this page and keep it left-aligned under the header/logo.
    <div className="w-full max-w-[760px]">
      <h1 className="font-display text-3xl leading-none text-ink">Connections</h1>

      <div className="mt-7 flex flex-col gap-8">
        <IntegrationsClient />
        <TicketPreferences initialValue={ctx.ticketGuidance} />
      </div>
    </div>
  );
}
