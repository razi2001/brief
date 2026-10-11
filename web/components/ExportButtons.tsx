"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TrackerLogo } from "./TrackerLogo";
import { PROVIDER_LABELS, type ProviderKey } from "./provider-labels";

// Primary action: solid accent, clearly the main thing to do.
const BTN_PRIMARY = "btn-accent disabled:opacity-60";
// Further trackers: the quiet button, so there is only ever one orange primary.
const BTN_SECONDARY = "btn disabled:opacity-60";

/**
 * Owner-only export controls on a drafted brief. Files the draft to the chosen
 * tracker (POST /api/briefs/:id/export, owner-checked), then reloads. Rendered
 * as compact accent pills so they sit inline in the ticket's action toolbar.
 * Only trackers the owner has connected are offered.
 */
export default function ExportButtons({
  briefId,
  connected,
}: {
  briefId: string;
  /** Trackers this owner has connected; one button each. */
  connected: ProviderKey[];
}) {
  const [busy, setBusy] = useState<ProviderKey | null>(null);
  const [err, setErr] = useState("");
  const router = useRouter();

  async function exportTo(provider: ProviderKey) {
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

  if (!connected.length) {
    // No tracker yet → a clear accent-outline CTA (distinct from the solid
    // "Export" primary, but still obviously the thing to do next).
    return (
      <a
        href="/connections"
        className="btn !text-accent"
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
      {connected.map((provider, i) => (
        <button
          key={provider}
          type="button"
          disabled={!!busy}
          onClick={() => exportTo(provider)}
          className={i === 0 ? BTN_PRIMARY : BTN_SECONDARY}
        >
          <span className={i === 0 ? "grid h-4 w-4 place-items-center rounded-[4px] bg-white/90" : "grid place-items-center"}><TrackerLogo kind={provider} size={i === 0 ? 11 : 13} /></span>
          {busy === provider ? "Filing…" : `Export to ${PROVIDER_LABELS[provider]}`}
        </button>
      ))}
      {err && <span className="ml-1 text-xs text-[#c62828]">{err}</span>}
    </>
  );
}
