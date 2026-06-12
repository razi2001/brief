"use client";

import { useState } from "react";
import { ROLES } from "@/lib/onboarding-options";

/**
 * Editable "your role" field, persisted to the Clerk user's privateMetadata
 * via POST /api/settings (same path the onboarding wizard writes). Lives on
 * the Connections page so the role captured at onboarding isn't a one-shot —
 * it can be changed any time, and the agent reads it server-side when writing
 * tickets. A free-text "Other" keeps it open-ended.
 */
export default function ProfileSettings({ initialRole }: { initialRole: string }) {
  // Is the initial role one of the presets, or a custom value?
  const presetLabels = ROLES.map((r) => r.label);
  const initialIsPreset = presetLabels.includes(initialRole);

  const [role, setRole] = useState(initialRole);
  const [custom, setCustom] = useState(initialIsPreset ? "" : initialRole);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  // The value we'd persist: a chosen preset, or the typed custom text.
  const effective = role === "__custom" ? custom.trim() : role;
  const dirty = effective !== initialRole;

  async function save() {
    setError("");
    setState("saving");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ role: effective }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setState("saved");
      setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1800);
    } catch (e) {
      setState("idle");
      setError(e instanceof Error ? e.message : "Couldn't save — please try again.");
    }
  }

  return (
    <section id="profile" className="card px-4 py-4 scroll-mt-8">
      <h2 className="font-display text-2xl text-ink">Your role</h2>
      <p className="mt-1 text-xs text-muted">
        Brief tailors the tickets it writes to how your team works. Change it any
        time.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {ROLES.map((r) => {
          const active = role === r.label;
          return (
            <button
              key={r.label}
              type="button"
              onClick={() => setRole(active ? "" : r.label)}
              aria-pressed={active}
              className={`cursor-pointer rounded-full border px-3.5 py-1.5 font-mono text-[0.8125rem] transition-colors ${
                active
                  ? "border-accent bg-[rgba(221,105,54,.12)] text-accent"
                  : "border-hairline bg-[#fffdf8] text-ink-2 hover:border-[rgba(221,105,54,.4)] hover:text-ink"
              }`}
            >
              {r.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setRole("__custom")}
          aria-pressed={role === "__custom"}
          className={`cursor-pointer rounded-full border px-3.5 py-1.5 font-mono text-[0.8125rem] transition-colors ${
            role === "__custom"
              ? "border-accent bg-[rgba(221,105,54,.12)] text-accent"
              : "border-hairline bg-[#fffdf8] text-ink-2 hover:border-[rgba(221,105,54,.4)] hover:text-ink"
          }`}
        >
          Custom…
        </button>
      </div>

      {role === "__custom" && (
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          maxLength={60}
          placeholder="e.g. Solutions engineer"
          className="mt-3 block w-64 max-w-full rounded-lg border hairline bg-[#fffdf8] px-3.5 py-2 font-mono text-[0.8125rem] text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-accent"
        />
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={state === "saving" || !dirty}
          className="pill cursor-pointer border-[rgba(221,105,54,.35)] bg-[rgba(221,105,54,.1)] text-accent transition-colors hover:bg-[rgba(221,105,54,.18)] disabled:opacity-50"
        >
          {state === "saving" ? "Saving…" : state === "saved" ? "Saved ✓" : "Save"}
        </button>
        {error && <span className="text-xs text-[#c62828]">{error}</span>}
      </div>
    </section>
  );
}
