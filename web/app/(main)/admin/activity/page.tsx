import FreshOnReturn from "@/components/FreshOnReturn";
import ActivityView from "@/components/ActivityView";
import { loadActivity } from "@/lib/activity-server";
import { RANGES } from "@/lib/activity-stats";
import { requireAdmin } from "@/lib/admin-server";

/** Day by day: visits and where they came from, sign-ups, who is active, how far people got. 404 for anyone but the owner. */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const asked = Number((await searchParams).days);
  const days = (RANGES as readonly number[]).includes(asked) ? asked : 30;
  const { people, site, dashboard, nudge, now } = await loadActivity(days);
  return (
    <>
      <FreshOnReturn renderId={crypto.randomUUID()} />
      <ActivityView people={people} site={site} dashboard={dashboard} nudge={nudge} days={days} now={now} />
    </>
  );
}
