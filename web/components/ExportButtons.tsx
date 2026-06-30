"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TrackerLogo } from "./TrackerLogo";

const ACCENT_PILL =
  "inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-cream transition hover:brightness-95 disabled:opacity-60";

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
    return (
      <a
        href="/connections"
        className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-cream/50 px-3 py-1.5 text-xs text-ink-2 no-underline transition-colors hover:bg-cream-2/70 hover:text-ink"
      >
        Connect a tracker to export →
      </a>
    );
  }

  return (
    <>
      {linear && (
        <button type="button" disabled={!!busy} onClick={() => exportTo("linear")} className={ACCENT_PILL}>
          <TrackerLogo kind="linear" size={13} />
          {busy === "linear" ? "Filing…" : "Export to Linear"}
        </button>
      )}
      {jira && (
        <button type="button" disabled={!!busy} onClick={() => exportTo("jira")} className={ACCENT_PILL}>
          <TrackerLogo kind="jira" size={13} />
          {busy === "jira" ? "Filing…" : "Export to Jira"}
        </button>
      )}
      {err && <span className="text-xs text-[#c62828]">{err}</span>}
    </>
  );
}
