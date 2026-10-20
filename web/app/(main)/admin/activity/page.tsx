import ActivityView from "@/components/ActivityView";
import { loadActivity } from "@/lib/activity-server";
import { requireAdmin } from "@/lib/admin-server";

/** Who signed up, how far they got, and what get-brief.app visitors did. 404 for anyone but the owner. */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const days = (await searchParams).days === "30" ? 30 : 7;
  const { people, site, now } = await loadActivity(days);
  return <ActivityView people={people} site={site} days={days} now={now} />;
}
