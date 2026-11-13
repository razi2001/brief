import { redirect } from "next/navigation";

/** Drafts live on the Tickets page now, under its Drafts tab. Old links land there. */
export default function DraftsPage() {
  redirect("/tickets?show=drafts");
}
