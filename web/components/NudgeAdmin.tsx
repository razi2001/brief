"use client";

import { useState } from "react";
import { fieldFocusClass } from "./SettingsSection";
import { DEFAULT_BUTTON, DEFAULT_MESSAGE, MAX_BUTTON, MAX_MESSAGE, type NudgeText } from "@/lib/nudge";

const inputClass = `block w-full rounded-lg border hairline bg-surface px-3 py-2 text-[14px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted/60 ${fieldFocusClass}`;

// The server renders in UTC on Fly; the owner reads Paris time.
export function whenParis(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** The card as the extension draws it, for the preview. */
export function CardPreview({ message, button }: { message: string; button: string }) {
  return (
    <div
      aria-label="Card preview"
      className="inline-flex items-center gap-2.5 rounded-full py-[7px] pl-4 pr-[7px] text-[14px] font-medium"
      style={{
        background: "linear-gradient(180deg, rgba(42,38,34,.95), rgba(18,16,14,.97))",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,.09), 0 12px 32px rgba(0,0,0,.28)",
        color: "rgba(245,241,232,.94)",
      }}
    >
      <span>{message}</span>
      <span className="rounded-full bg-[#dd6936] px-3.5 py-[7px] text-[13px] font-semibold text-white">{button}</span>
      <span className="grid h-7 w-7 place-items-center" style={{ color: "rgba(245,241,232,.6)" }} aria-hidden>
        ×
      </span>
    </div>
  );
}

/** "Show the card": to one person (`userId`) or to everyone. */
export function PushCardButton({ userId, last, label }: { userId?: string; last: string | null; label: string }) {
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [at, setAt] = useState(last);

  async function push() {
    if (!userId && !confirm("Show the card to everyone on their next page load?")) return;
    setState("sending");
    const res = await fetch("/api/admin/nudge/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userId ? { userId } : {}),
    }).catch(() => null);
    const data = res?.ok ? ((await res.json()) as { at: string }) : null;
    if (!data) return setState("error");
    setAt(data.at);
    setState("idle");
  }

  return (
    <span className="inline-flex items-center gap-3">
      <button type="button" onClick={push} disabled={state === "sending"} className="btn">
        {label}
      </button>
      <span className={`text-[13px] ${state === "error" ? "text-[#c62828]" : "text-muted"}`}>
        {state === "error" ? "Not sent" : at ? `Last sent ${whenParis(at)}` : null}
      </span>
    </span>
  );
}

export default function NudgeAdmin({ saved, lastEveryone }: { saved: NudgeText; lastEveryone: string | null }) {
  const [message, setMessage] = useState(saved.message);
  const [button, setButton] = useState(saved.button);
  const [stored, setStored] = useState(saved);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const dirty = message.trim() !== stored.message || button.trim() !== stored.button;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    const res = await fetch("/api/admin/nudge", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, button }),
    }).catch(() => null);
    const data = res?.ok ? ((await res.json()) as NudgeText) : null;
    if (!data) return setState("error");
    setStored({ message: data.message, button: data.button });
    setMessage(data.message);
    setButton(data.button);
    setState("idle");
  }

  return (
    <section>
      <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">Bug card</h1>

      <div className="card mt-6 grid place-items-center bg-hairline/30 py-10">
        <CardPreview message={message.trim() || DEFAULT_MESSAGE} button={button.trim() || DEFAULT_BUTTON} />
      </div>

      <form onSubmit={save} className="card mt-4 grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-end">
        <label className="grid gap-1 text-[13px] text-muted">
          Text
          <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={MAX_MESSAGE} placeholder={DEFAULT_MESSAGE} className={inputClass} />
        </label>
        <label className="grid gap-1 text-[13px] text-muted">
          Button
          <input value={button} onChange={(e) => setButton(e.target.value)} maxLength={MAX_BUTTON} placeholder={DEFAULT_BUTTON} className={inputClass} />
        </label>
        <button type="submit" disabled={!dirty || state === "saving"} className="btn-accent">
          Save
        </button>
        {state === "error" && <p className="text-[13px] text-[#c62828] sm:col-span-3">Not saved</p>}
      </form>

      <div className="card mt-4 flex flex-wrap items-center justify-between gap-3 p-4">
        <span className="text-[14px] text-ink">Everyone</span>
        <PushCardButton label="Show to everyone" last={lastEveryone} />
      </div>
    </section>
  );
}
