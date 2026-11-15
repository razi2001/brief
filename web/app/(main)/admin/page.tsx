import FreshOnReturn from "@/components/FreshOnReturn";
import AdminView from "@/components/AdminView";
import { loadAdminRows, requireAdmin } from "@/lib/admin-server";
import { parseFilters } from "@/lib/admin-view";

/** The owner's view of every ticket and draft, across every user. 404 for anyone else. */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const [rows, params] = await Promise.all([loadAdminRows(), searchParams]);
  return (
    <>
      <FreshOnReturn renderId={crypto.randomUUID()} />
      <AdminView rows={rows} initial={parseFilters(params)} />
    </>
  );
}
