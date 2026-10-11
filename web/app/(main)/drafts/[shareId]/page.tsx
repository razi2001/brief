import type { Metadata } from "next";
import BriefView, { briefMetadata } from "@/components/BriefView";

// Signed media URLs expire, so never cache the rendered page.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ shareId: string }> }): Promise<Metadata> {
  const { shareId } = await params;
  return briefMetadata(shareId);
}

/** A brief opened inside the app: the sidebar stays, a breadcrumb leads back to Drafts. */
export default async function Page({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  return <BriefView shareId={shareId} section="drafts" />;
}
