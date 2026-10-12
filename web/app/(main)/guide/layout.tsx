import { requireUserId } from "@/lib/auth";
import { getGuideStatus } from "@/lib/guide/status-server";
import { GuideFactsProvider } from "@/components/guide/GuideFacts";

/**
 * The Guide's frame: asks once what you've already set up, without waiting
 * for the answer, so the hub and every lesson (static pages) show at once.
 */
export default async function GuideLayout({ children }: { children: React.ReactNode }) {
  const userId = await requireUserId();
  return <GuideFactsProvider facts={getGuideStatus(userId)}>{children}</GuideFactsProvider>;
}
