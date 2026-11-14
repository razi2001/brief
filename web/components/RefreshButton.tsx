"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Small icon button that re-fetches the server data for the current route
 * (router.refresh()) - used on the tickets feed and dashboard so live tracker
 * state can be pulled on demand instead of waiting for the auto-poll.
 */
export default function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      title="Refresh tickets"
      aria-label="Refresh tickets"
      disabled={pending}
      className="btn-ghost h-[30px] w-[30px] disabled:opacity-60"
    >
      <svg
        viewBox="0 0 24 24"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={pending ? "animate-spin" : undefined}
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  );
}
