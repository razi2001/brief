"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TrackerLogo } from "./TrackerLogo";

// Primary action: solid accent, clearly the main thing to do.
const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-cream shadow-[0_1px_2px_rgba(221,105,54,0.25)] transition hover:brightness-95 disabled:opacity-60";

/**
 * Owner-only export controls on a drafted brief. Files the draft to the chosen
 * tracker (POST /api/briefs/:id/export, owner-checked), then reloads. Rendered
 * as compact accent pills so they sit inline in the ticket's action toolbar.
 * Only trackers the owner has connected are offered.
 */
export default function ExportButtons({
  briefId,
  linear,
  jira,
}: {
  briefId: string;
  linear: boolean;
  jira: boolean;
}) {
  const [busy, setBusy] = useState<null | "linear" | "jira">(null);
  const [err, setErr] = useState("");
  const router = useRouter();

  async function exportTo(provider: "linear" | "jira") {
    setBusy(provider);
    setErr("");
    try {
      const res = await fetch(`/api/briefs/${briefId}/export`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      if (res.ok) {
        // Soft refresh: the page re-renders into the in-place "Filing…" state
        // (toolbar/content intact) and polls itself to the filed view.
        router.refresh();
        return;
      }
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(j?.error || "Export failed - try again.");
      setBusy(null);
    } catch {
      setErr("Export failed - try again.");
      setBusy(null);
    }
  }

  if (!linear && !jira) {
    // No tracker yet → a clear accent-outline CTA (distinct from the solid
    // "Export" primary, but still obviously the thing to do next).
    return (
      <a
        href="/connections"
        className="inline-flex items-center gap-1.5 rounded-lg border border-accent/35 bg-accent/[0.07] px-3 py-1.5 text-xs font-medium text-accent no-underline transition-colors hover:bg-accent/[0.13]"
      >
        Connect a tracker
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </a>
    );
  }

  return (
    <>
      {linear && (
        <button type="button" disabled={!!busy} onClick={() => exportTo("linear")} className={BTN_PRIMARY}>
          <TrackerLogo kind="linear" size={13} />
          {busy === "linear" ? "Filing…" : "Export to Linear"}
        </button>
      )}
      {jira && (
        <button type="button" disabled={!!busy} onClick={() => exportTo("jira")} className={BTN_PRIMARY}>
          <TrackerLogo kind="jira" size={13} />
          {busy === "jira" ? "Filing…" : "Export to Jira"}
        </button>
      )}
      {err && <span className="text-xs text-[#c62828]">{err}</span>}
    </>
  );
}
