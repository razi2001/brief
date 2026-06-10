"use client";

import { useState } from "react";

/**
 * Account-level ticket guidance editor. The value is stored on the Clerk user's
 * privateMetadata via POST /api/settings (same-origin, Clerk-session-authed) and
 * applied server-side by the agent when it writes tickets.
 */
export default function TicketPreferences({
  initialValue,
}: {
  initialValue: string;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  async function save() {
    setError("");
    setState("saving");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ticketGuidance: value }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setState("saved");
      setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1800);
    } catch (e: any) {
      setState("idle");
      setError(e?.message || "Couldn't save — please try again.");
    }
  }

  return (
    <section id="ticket-preferences" className="card px-4 py-4 scroll-mt-8">
      <h2 className="font-display text-2xl text-ink">Ticket preferences</h2>
      <p className="mt-1 text-xs text-muted">
        Guidance the agent follows when writing your tickets — tone, labels, what
        to include.
      </p>

      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={5}
        spellCheck={false}
        placeholder="e.g. Status: Backlog. Priority: Medium.
Label every ticket “inbound”.
Bugs → Engineering, features → Product."
        className="mt-3 block w-full resize-y rounded-xl border hairline bg-[#fffdf8] px-3.5 py-3 font-mono text-[13px] leading-relaxed text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-accent"
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={state === "saving"}
          className="pill cursor-pointer border-[rgba(221,105,54,.35)] bg-[rgba(221,105,54,.1)] text-accent transition-colors hover:bg-[rgba(221,105,54,.18)] disabled:opacity-50"
        >
          {state === "saving" ? "Saving…" : state === "saved" ? "Saved ✓" : "Save"}
        </button>
        {error && <span className="text-xs text-[#c62828]">{error}</span>}
      </div>
    </section>
  );
}
