"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, type ReactNode } from "react";

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

/** The sidebar's items, also drawn by the Guide's illustrations. */
export const NAV_ITEMS = [
  // The first page. An open draft (/drafts/<id>) still lights this item.
  { href: "/tickets", label: "Tickets", also: "/drafts", icon: icon(<><path d="M3 4h10M3 8h10M3 12h6" /></>) },
  { href: "/competition", label: "Quality competition", icon: icon(<><path d="M4.5 2.5h7v3.8a3.5 3.5 0 0 1-7 0Z" /><path d="M4.5 4H3a1.5 1.5 0 0 0 0 3h1.7M11.5 4H13a1.5 1.5 0 0 1 0 3h-1.7" /><path d="M8 9.8v2.4M5.5 13.5h5" /></>) },
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
      className={`nav-link relative flex h-8 shrink-0 items-center gap-2 rounded-[7px] px-2 text-[13.5px] no-underline transition-colors duration-150 sm:h-[30px] sm:gap-2.5 ${quiet ? "" : "font-medium"} ${
        active ? "text-ink" : `${quiet ? "text-muted" : "text-ink-2"} hover:bg-hover hover:text-ink`
      }`}
    >
      <span className={`relative transition-colors duration-150 ${active ? "text-accent" : "text-muted"}`}>{item.icon}</span>
      <span className="relative">{item.label}</span>
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
export default function Nav({ extra, base = "" }: { extra?: ReactNode; base?: string }) {
  const at = (item: Item): Item => ({ ...item, href: base + item.href, also: item.also && base + item.also });
  const main = NAV_ITEMS.filter((item) => !HELP_HREFS.includes(item.href)).map(at);
  const help = NAV_ITEMS.filter((item) => HELP_HREFS.includes(item.href)).map(at);
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const pathname = usePathname();

  // One highlight for the whole list: it sits behind the current item and
  // slides to the next one. Placed by measuring, so it follows links that
  // stream in late (the owner's) and the gap before the help links. Until it
  // is placed, the current link carries its own background (see globals.css).
  useLayoutEffect(() => {
    const nav = navRef.current;
    const pill = pillRef.current;
    if (!nav || !pill) return;
    const place = () => {
      const el = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!el) {
        pill.style.opacity = "0";
        return;
      }
      const a = nav.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      pill.style.opacity = "1";
      pill.style.height = `${b.height}px`;
      pill.style.transform = `translateY(${b.top - a.top}px)`;
      nav.dataset.pill = "";
    };
    place();
    // It appears in place the first time, and only moves after that: the
    // position is committed (a forced style read) before the transition is on.
    void pill.offsetHeight;
    pill.dataset.ready = "";
    const mo = new MutationObserver(place);
    mo.observe(nav, { childList: true, subtree: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    ro?.observe(nav);
    return () => {
      mo.disconnect();
      ro?.disconnect();
    };
  }, [pathname]);

  return (
    <nav ref={navRef} aria-label="Primary" className="nav relative flex gap-0.5 sm:flex-1 sm:flex-col sm:gap-px">
      <span ref={pillRef} aria-hidden className="nav-pill" />
      {main.map((item) => (
        <NavLink key={item.href} item={item} />
      ))}
      {extra}
      <div className="flex gap-0.5 sm:mt-auto sm:flex-col sm:gap-px sm:pt-4">
        {help.map((item) => (
          <NavLink key={item.href} item={item} quiet />
        ))}
      </div>
    </nav>
  );
}
