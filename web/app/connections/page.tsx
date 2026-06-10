import { UserButton } from "@clerk/nextjs";
import { requireUserId } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import Integrations from "@/components/Integrations";
import TicketPreferences from "@/components/TicketPreferences";
import { getTrackerContext } from "@/lib/briefs-server";

export default async function ConnectionsPage() {
  await requireUserId();
  const ctx = await getTrackerContext();

  return (
    <AppShell headerRight={<UserButton />}>
      <h1 className="font-display text-3xl leading-none text-ink">Connections</h1>
      <p className="mt-1.5 text-sm text-muted">
        Connect a tracker so Brief can file your bugs, and tune how the agent writes them.
      </p>

      <div className="mt-2">
        <Integrations />
        <div className="mt-8">
          <TicketPreferences initialValue={ctx.ticketGuidance} />
        </div>
      </div>
    </AppShell>
  );
}
