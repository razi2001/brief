import { Suspense } from "react";
import { UserButton } from "@clerk/nextjs";
import AppShell from "@/components/AppShell";
import { SidebarWorkspace } from "@/components/SidebarInfo";

/**
 * Shared shell for the authed app (Dashboard / Briefs / Connections). Rendering
 * the header + Nav here - not inside each page - means navigating between these
 * routes never unmounts the shell: the nav stays put and only the page content
 * swaps. The data-heavy page bodies suspend behind loading.tsx, so navigation
 * feels instant (shell + skeleton immediately) and the DB/tracker fetch streams
 * in after. The sidebar's workspace line streams in the same way.
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      workspace={
        <Suspense fallback={null}>
          <SidebarWorkspace />
        </Suspense>
      }
      headerRight={
        <UserButton
          showName
          appearance={{
            elements: {
              userButtonBox: "flex-row-reverse gap-2",
              userButtonOuterIdentifier: "hidden pl-0 text-[13px] font-medium text-ink-2 sm:block",
              userButtonTrigger: "rounded-lg px-1 py-1 hover:bg-white/40 focus:shadow-none",
            },
          }}
        />
      }
    >
      {children}
    </AppShell>
  );
}
