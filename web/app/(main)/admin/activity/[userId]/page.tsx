import { notFound } from "next/navigation";
import ActivityTimeline from "@/components/ActivityTimeline";
import { loadPerson } from "@/lib/activity-server";
import { requireAdmin } from "@/lib/admin-server";

/** One person's timeline, newest first. */
export default async function PersonActivityPage({ params }: { params: Promise<{ userId: string }> }) {
  await requireAdmin();
  const found = await loadPerson((await params).userId);
  if (!found) notFound();
  return <ActivityTimeline person={found.person} items={found.items} now={found.now} />;
}
