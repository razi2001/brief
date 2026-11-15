import BashNew from "@/components/BashNew";
import { requireUserId } from "@/lib/auth";
import { peekSuggestions } from "@/lib/bash-suggest-server";

/** New bug bash: the form, on a page of its own. */
export default async function NewBashPage() {
  const userId = await requireUserId();
  return <BashNew suggested={peekSuggestions(userId)} />;
}
