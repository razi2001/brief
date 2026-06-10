"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/tickets", label: "Tickets" },
  { href: "/connections", label: "Connections" },
] as const;

/**
 * Top-level navigation: a segmented pill of real links (Dashboard / Briefs /
 * Connections). Reuses the segmented-control styling from the old in-page tabs,
 * but as routed <Link>s so each view has its own URL (and the extension can
 * deep-link to /tickets). Active state is derived from the pathname.
 */
export default function Nav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="flex gap-1 rounded-full bg-cream-2 p-1 shadow-[inset_0_0_0_1px_rgba(26,22,18,.12)]"
    >
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`cursor-pointer rounded-full px-3.5 py-1.5 font-mono text-xs tracking-wide no-underline transition-[color,box-shadow,background-color] duration-200 sm:px-4 ${
              active
                ? "bg-[#fffdf8] text-ink shadow-[0_1px_3px_rgba(26,22,18,.12)]"
                : "bg-transparent text-muted hover:text-ink-2"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
