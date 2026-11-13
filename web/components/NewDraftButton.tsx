"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** The Tickets page's primary action: start a blank draft and open it to write. */
export default function NewDraftButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function create() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/drafts", { method: "POST", credentials: "same-origin" });
      const j = (await res.json().catch(() => ({}))) as { shareId?: string };
      // Stays busy while the page opens, so a second click can't make a second draft.
      if (res.ok && j.shareId) return router.push(`/drafts/${j.shareId}`);
    } catch {
      /* offline: same as a refusal */
    }
    setFailed(true);
    setBusy(false);
  }

  return (
    <>
      {failed && <span className="text-xs text-[#c62828]">Couldn&apos;t create the draft</span>}
      <button type="button" onClick={create} disabled={busy} className="btn-accent h-8">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        New draft
      </button>
    </>
  );
}
