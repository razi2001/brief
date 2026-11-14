import { redirect } from "next/navigation";

/** Home moved into Tickets, which is the first page now. Old links land there. */
export default function DashboardPage() {
  redirect("/tickets");
}
