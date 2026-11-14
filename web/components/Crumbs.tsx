import Link from "next/link";
import { Fragment } from "react";

export type Crumb = { label: string; href?: string };

/**
 * Where a page sits: its parents as links, then the page itself. One quiet
 * line above the title.
 */
export default function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[13px] text-muted">
      {items.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 opacity-60">
              <path d="M6 3.5 10.5 8 6 12.5" />
            </svg>
          )}
          {c.href ? (
            <Link href={c.href} className="-mx-1 shrink-0 rounded px-1 py-0.5 text-muted no-underline transition-colors hover:bg-hover hover:text-ink">
              {c.label}
            </Link>
          ) : (
            <span aria-current="page" className="min-w-0 truncate text-ink-2">
              {c.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
