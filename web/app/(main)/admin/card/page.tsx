import NudgeAdmin from "@/components/NudgeAdmin";
import { requireAdmin } from "@/lib/admin-server";
import { getSavedText, lastPushes } from "@/lib/nudge-server";

/** The extension's "Seen a bug?" card: its text, and showing it to everyone now. 404 for anyone but the owner. */
export default async function CardPage() {
  await requireAdmin();
  const [saved, last] = await Promise.all([getSavedText(), lastPushes(null)]);
  return <NudgeAdmin saved={saved} lastEveryone={last.everyone} />;
}
