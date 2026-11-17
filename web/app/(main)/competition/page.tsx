import FreshOnReturn from "@/components/FreshOnReturn";
import BashHome from "@/components/BashHome";
import { requireUserId } from "@/lib/auth";
import { listBashes, type BashListItem } from "@/lib/bash-server";
import { peekSuggestions } from "@/lib/bash-suggest-server";
import { monthlyCompetition } from "@/lib/competition-server";

/** Quality competition: the quality competitions you can take part in (yours, all of your org's, the closed ones), and a button to make one. */
export default async function BashPage() {
  const userId = await requireUserId();
  // If the list can't be read, making one still works.
  const [bashes, monthly] = await Promise.all([listBashes(userId).catch((): BashListItem[] => []), monthlyCompetition(userId)]);
  return (
    <>
      <FreshOnReturn renderId={crypto.randomUUID()} />
      <BashHome bashes={bashes} suggested={peekSuggestions(userId)} monthly={monthly} />
    </>
  );
}
