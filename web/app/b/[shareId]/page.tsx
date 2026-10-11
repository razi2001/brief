import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUserId } from "@/lib/auth";
import BriefView, { appSectionOf, briefMetadata, loadBrief } from "@/components/BriefView";

// Signed media URLs expire, so never cache the rendered page.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ shareId: string }> }): Promise<Metadata> {
  const { shareId } = await params;
  return briefMetadata(shareId);
}

/**
 * The share link. A visitor reads the brief on its own page; anyone signed in
 * opens it inside the app instead (sidebar, breadcrumb), under Tickets or
 * Drafts - so the link the extension opens after a capture lands in the app.
 */
export default async function SharePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  if (await getUserId()) {
    const brief = await loadBrief(shareId);
    if (brief) redirect(`/${appSectionOf(brief)}/${shareId}`);
  }
  return <BriefView shareId={shareId} />;
}
