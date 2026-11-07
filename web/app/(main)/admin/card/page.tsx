import NudgeAdmin, { EveryoneRow } from "@/components/NudgeAdmin";
import NudgePeople from "@/components/NudgePeople";
import { requireAdmin } from "@/lib/admin-server";
import { getSavedText, loadCardPeople } from "@/lib/nudge-server";

/**
 * The extension's reminder: the line on top of the popup it opens under its
 * toolbar icon, and showing it now to everyone or to the people picked, with
 * what each did with it. 404 for anyone but the owner.
 */
export default async function CardPage() {
  await requireAdmin();
  const [saved, { people, everyone, now }] = await Promise.all([getSavedText(), loadCardPeople()]);
  return (
    <NudgeAdmin saved={saved}>
      <EveryoneRow last={everyone} />
      <NudgePeople people={people} now={now} />
    </NudgeAdmin>
  );
}
