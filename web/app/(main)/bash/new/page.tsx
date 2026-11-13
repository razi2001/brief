import BashNew from "@/components/BashNew";
import { requireUserId } from "@/lib/auth";

/** New bug bash: the form, on a page of its own. */
export default async function NewBashPage() {
  await requireUserId();
  return <BashNew />;
}
