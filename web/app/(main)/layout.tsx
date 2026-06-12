import { UserButton } from "@clerk/nextjs";
import AppShell from "@/components/AppShell";
import ExtensionTokenSync from "@/components/ExtensionTokenSync";

/**
 * Shared shell for the authed app (Dashboard / Briefs / Connections). Rendering
 * the header + Nav here - not inside each page - means navigating between these
 * routes never unmounts the shell: the nav stays put and only the page content
 * swaps. The data-heavy page bodies suspend behind loading.tsx, so navigation
 * feels instant (shell + skeleton immediately) and the DB/tracker fetch streams
 * in after.
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell headerRight={<UserButton />}>
      {/* Re-pairs the extension whenever the signed-in account changes. */}
      <ExtensionTokenSync />
      {children}
    </AppShell>
  );
}
