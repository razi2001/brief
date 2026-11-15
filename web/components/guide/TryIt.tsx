"use client";

import Link from "next/link";
import type { Lesson } from "@/lib/guide/lessons";
import { CHROME_STORE_URL } from "@/lib/chrome-store";

const check = (
  <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 6.2 5 8.5l4.5-5" />
  </svg>
);

/** "Mark as done", then a quiet green "Done". */
export function DoneToggle({ done, onDone }: { done: boolean; onDone: () => void }) {
  return done ? (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[rgba(47,125,79,.1)] px-3 text-[13px] font-medium text-[#2f7d4f]">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#2f7d4f] text-white">{check}</span>
      Done
    </span>
  ) : (
    <button
      type="button"
      onClick={onDone}
      className="group inline-flex h-8 items-center gap-1.5 rounded-full border border-[rgba(26,22,18,.12)] bg-white/70 px-3 text-[13px] font-medium text-ink-2 transition-colors hover:border-[#2f7d4f]/40 hover:text-ink"
    >
      <span className="flex h-4 w-4 items-center justify-center rounded-full border border-[rgba(26,22,18,.25)] text-transparent transition-colors group-hover:border-[#2f7d4f] group-hover:text-[#2f7d4f]">
        {check}
      </span>
      Mark as done
    </button>
  );
}

/** Under the steps: where to do it for real, when that's a page or a store. */
export function LessonAction({ lesson }: { lesson: Lesson }) {
  const t = lesson.tryIt;
  if (t.kind === "link")
    return (
      <div className="mt-3 px-3">
        <Link href={t.href} className="btn-accent">
          {t.label}
        </Link>
      </div>
    );
  if (t.kind === "install")
    return (
      <div className="mt-3 px-3">
        <a href={CHROME_STORE_URL} target="_blank" rel="noopener" className="btn-accent">
          Chrome Web Store
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M9 3h4v4M13 3 7 9M11 9.5V13H3V5h3.5" />
          </svg>
        </a>
      </div>
    );
  return null;
}
