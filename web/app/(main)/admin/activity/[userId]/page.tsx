import { notFound } from "next/navigation";
import ActivityTimeline from "@/components/ActivityTimeline";
import { loadPerson } from "@/lib/activity-server";
import { requireAdmin } from "@/lib/admin-server";
import { lastPushes } from "@/lib/nudge-server";
import { PushCardButton } from "@/components/NudgeAdmin";

/** One person's timeline, newest first. */
export default async function PersonActivityPage({ params }: { params: Promise<{ userId: string }> }) {
  await requireAdmin();
  const { userId } = await params;
  const [found, pushed] = await Promise.all([loadPerson(userId), lastPushes(userId)]);
  if (!found) notFound();
  return (
    <ActivityTimeline
      person={found.person}
      items={found.items}
      now={found.now}
      card={<PushCardButton userId={userId} last={pushed.person} label="Show the reminder" />}
    />
  );
}
