"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

/** The sidebar's items, also drawn by the Guide's illustrations. */
export const NAV_ITEMS = [
  { href: "/dashboard", label: "Home", icon: icon(<><rect x="2" y="2" width="5" height="6" rx="1.2" /><rect x="9" y="2" width="5" height="3.5" rx="1.2" /><rect x="9" y="7.5" width="5" height="6.5" rx="1.2" /><rect x="2" y="10" width="5" height="4" rx="1.2" /></>) },
  // Drafts are a tab of Tickets; an open draft (/drafts/<id>) still lights this item.
  { href: "/tickets", label: "Tickets", also: "/drafts", icon: icon(<><path d="M3 4h10M3 8h10M3 12h6" /></>) },
  { href: "/bash", label: "Bug bash", icon: icon(<><ellipse cx="8" cy="9.2" rx="3.2" ry="4" /><path d="M6.2 5.6a1.9 1.9 0 0 1 3.6 0M8 5.4v7.8M4.8 8H2.4M13.6 8h-2.4M5 11.2l-2 1.4M11 11.2l2 1.4M5.2 6.2 3.4 4.6M10.8 6.2l1.8-1.6" /></>) },
  { href: "/connections", label: "Settings", icon: icon(<><circle cx="8" cy="8" r="2" /><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" /></>) },
  { href: "/guide", label: "How to use Brief", icon: icon(<><path d="M8 4.2C6.6 3.1 4.6 2.7 2.5 2.9v9.4c2.1-.2 4.1.2 5.5 1.3 1.4-1.1 3.4-1.5 5.5-1.3V2.9c-2.1-.2-4.1.2-5.5 1.3Z" /><path d="M8 4.2v9.4" /></>) },
  // Always the last item: Nav draws it after the owner's links too.
  { href: "/requests", label: "Feature requests", icon: icon(<><path d="M6 12.5h4M6.6 14h2.8" /><path d="M8 1.8a4.2 4.2 0 0 0-2.4 7.6c.5.4.8.9.8 1.5v.3h3.2v-.3c0-.6.3-1.1.8-1.5A4.2 4.2 0 0 0 8 1.8Z" /></>) },
] as const;

type Item = { href: string; label: string; icon: ReactNode; exact?: boolean; also?: string };

/** The help links: they sit apart, at the foot of the sidebar, and read quieter. */
const HELP_HREFS: readonly string[] = ["/guide", "/requests"];

/**
 * One sidebar link, highlighted while you're on its route (or below it, unless
 * `exact`). `quiet` is the smaller look of the help links at the foot.
 */
export function NavLink({ item, quiet = false }: { item: Item; quiet?: boolean }) {
  const pathname = usePathname();
  const active =
    pathname === item.href || (!item.exact && pathname.startsWith(item.href + "/")) || (!!item.also && (pathname === item.also || pathname.startsWith(item.also + "/")));
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-[14px] font-medium no-underline sm:gap-3 sm:px-3 transition-colors ${
        quiet ? "sm:py-1.5 sm:text-[13.5px] sm:font-normal" : "sm:py-2 sm:text-[15px]"
      } ${
        active
          ? "bg-white/80 text-ink shadow-[0_1px_2px_rgba(26,22,18,.06),0_0_0_1px_rgba(26,22,18,.06)]"
          : "text-ink-2/80 hover:bg-white/45 hover:text-ink"
      }`}
    >
      <span className={active ? "text-accent" : "text-muted"}>{item.icon}</span>
      {item.label}
    </Link>
  );
}

/** The owner's monitoring view. Listed only when the server says you're the owner. */
export function AdminNavLink() {
  return (
    <NavLink
      item={{
        href: "/admin",
        label: "All tickets",
        icon: icon(<><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c1.7 1.7 2.5 3.7 2.5 6S9.7 12.3 8 14M8 2C6.3 3.7 5.5 5.7 5.5 8s.8 4.3 2.5 6" /></>),
        // /admin/activity has its own link.
        exact: true,
      }}
    />
  );
}

/** The owner's activity log: sign-ups, their setup, and the website. */
export function ActivityNavLink() {
  return (
    <NavLink
      item={{
        href: "/admin/activity",
        label: "Activity",
        icon: icon(<path d="M1.5 8.5h3l2-5 3 9 2-4h3" />),
      }}
    />
  );
}

/** The owner's control of the extension's "Seen a bug?" card. */
export function CardNavLink() {
  return (
    <NavLink
      item={{
        href: "/admin/card",
        label: "Bug card",
        icon: icon(<><rect x="2" y="4" width="12" height="8" rx="2" /><path d="M5 8h4" /></>),
      }}
    />
  );
}

/**
 * Primary navigation: a vertical list in the sidebar (Linear-style), a row in
 * the mobile top bar. Real links, so each view has its own URL and the
 * extension can deep-link to /tickets. `extra` streams in after the main
 * items (the owner's All tickets link). The help links (How to use Brief,
 * Feature requests) come last and, in the sidebar, drop to its foot in a
 * quieter look, so the list above is only the places you work in. Feature
 * requests is always the last thing.
 */
export default function Nav({ extra }: { extra?: ReactNode }) {
  const main = NAV_ITEMS.filter((item) => !HELP_HREFS.includes(item.href));
  const help = NAV_ITEMS.filter((item) => HELP_HREFS.includes(item.href));
  return (
    <nav aria-label="Primary" className="flex gap-0.5 sm:flex-1 sm:flex-col sm:gap-1">
      {main.map((item) => (
        <NavLink key={item.href} item={item} />
      ))}
      {extra}
      <div className="flex gap-0.5 sm:mt-auto sm:flex-col sm:gap-0.5 sm:pt-4">
        {help.map((item) => (
          <NavLink key={item.href} item={item} quiet />
        ))}
      </div>
    </nav>
  );
}
