"use client";

import { useState } from "react";
import { TrackerLogo } from "./TrackerLogo";

/**
 * Owner-only export controls on a drafted brief's page. Files the draft to the
 * chosen tracker (POST /api/briefs/:id/export, owner-checked server-side), then
 * reloads so the page re-renders as a filed ticket. Only trackers the owner has
 * connected are offered.
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
        window.location.reload();
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
      <p className="text-xs text-muted">
        Connect Linear or Jira in Brief Cloud to export this draft.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {linear && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => exportTo("linear")}
            className="btn-accent disabled:opacity-60"
          >
            <TrackerLogo kind="linear" size={14} />
            {busy === "linear" ? "Filing…" : "Export to Linear"}
          </button>
        )}
        {jira && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => exportTo("jira")}
            className="btn-accent disabled:opacity-60"
          >
            <TrackerLogo kind="jira" size={14} />
            {busy === "jira" ? "Filing…" : "Export to Jira"}
          </button>
        )}
      </div>
      {err && <p className="text-xs text-[#c62828]">{err}</p>}
    </div>
  );
}
