"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

const ITEMS = [
  { href: "/dashboard", label: "Home", icon: icon(<><rect x="2" y="2" width="5" height="6" rx="1.2" /><rect x="9" y="2" width="5" height="3.5" rx="1.2" /><rect x="9" y="7.5" width="5" height="6.5" rx="1.2" /><rect x="2" y="10" width="5" height="4" rx="1.2" /></>) },
  { href: "/tickets", label: "Tickets", icon: icon(<><path d="M3 4h10M3 8h10M3 12h6" /></>) },
  { href: "/drafts", label: "Drafts", icon: icon(<><path d="M9.5 2.5H4.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5.5" /><path d="m12.8 2.2 1 1L9 8l-1.6.6.6-1.6 4.8-4.8Z" /></>) },
  { href: "/connections", label: "Settings", icon: icon(<><circle cx="8" cy="8" r="2" /><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" /></>) },
] as const;

type Item = { href: string; label: string; icon: ReactNode };

/** One sidebar link, highlighted while you're on its route (or below it). */
export function NavLink({ item }: { item: Item }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(item.href + "/");
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-[14px] font-medium no-underline sm:gap-3 sm:px-3 sm:py-2 sm:text-[15px] transition-colors ${
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
      }}
    />
  );
}

/**
 * Primary navigation: a vertical list in the sidebar (Linear-style), a row in
 * the mobile top bar. Real links, so each view has its own URL and the
 * extension can deep-link to /tickets. `extra` streams in after the fixed
 * items (the owner's All tickets link).
 */
export default function Nav({ extra }: { extra?: ReactNode }) {
  return (
    <nav aria-label="Primary" className="flex gap-0.5 sm:flex-col sm:gap-1">
      {ITEMS.map((item) => (
        <NavLink key={item.href} item={item} />
      ))}
      {extra}
    </nav>
  );
}
