import FreshOnReturn from "@/components/FreshOnReturn";
import { notFound } from "next/navigation";
import BashView from "@/components/BashView";
import { requireUserId } from "@/lib/auth";
import { isBashCode } from "@/lib/bash";
import { loadBash } from "@/lib/bash-server";

/** One quality competition: live while it runs, its report once it is over. */
export default async function BashCodePage({ params }: { params: Promise<{ code: string }> }) {
  const userId = await requireUserId();
  const { code } = await params;
  if (!isBashCode(code)) notFound();
  const bash = await loadBash(code, userId);
  if (!bash) notFound();
  return (
    <>
      <FreshOnReturn renderId={crypto.randomUUID()} />
      <BashView initial={bash} />
    </>
  );
}
