import FreshOnReturn from "@/components/FreshOnReturn";
import AdminView from "@/components/AdminView";
import { loadAdminRows, requireAdmin } from "@/lib/admin-server";
import { parseFilters } from "@/lib/admin-view";
import { loadInstances } from "@/lib/telemetry-server";
import InstancesList from "@/components/InstancesList";

/**
 * The owner's usage view: who made tickets and drafts, never what they say
 * (lib/admin-view OWNER_FIELDS), and the self-hosted instances' heartbeats.
 * 404 for anyone else.
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const [rows, params, instances] = await Promise.all([loadAdminRows(), searchParams, loadInstances()]);
  return (
    <>
      <FreshOnReturn renderId={crypto.randomUUID()} />
      <AdminView rows={rows} initial={parseFilters(params)} />
      <InstancesList instances={instances} />
    </>
  );
}
