import BashHome from "@/components/BashHome";
import { requireUserId } from "@/lib/auth";
import { listBashes, type BashListItem } from "@/lib/bash-server";

/** Bug bash: the bug bashes you can take part in (yours, all of your org's, the closed ones), and a button to make one. */
export default async function BashPage() {
  const userId = await requireUserId();
  // If the list can't be read, making one still works.
  const bashes = await listBashes(userId).catch((): BashListItem[] => []);
  return <BashHome bashes={bashes} />;
}
