"use client";

import { useState } from "react";
import { fieldFocusClass } from "./SettingsSection";
import { DEFAULT_MESSAGE, MAX_MESSAGE, type NudgeText } from "@/lib/nudge";

const inputClass = `block w-full rounded-lg border hairline bg-surface px-3 py-2 text-[14px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted/60 ${fieldFocusClass}`;

// The server renders in UTC on Fly; the owner reads Paris time.
export function whenParis(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** The small reminder as it opens under the toolbar icon (extension/reminder.html). */
export function CardPreview({ message }: { message: string }) {
  return (
    <div aria-label="Card preview" className="w-[260px] rounded-xl bg-[#f5f1e8] p-3 shadow-[0_12px_32px_rgba(0,0,0,0.14)]">
      <div className="flex items-center gap-2.5">
        <svg viewBox="0 0 128 128" className="h-[26px] w-[26px] shrink-0" aria-hidden>
          <rect width="128" height="128" rx="28" fill="#dd6936" />
          <path
            fill="#f5f1e8"
            d="M26 38 Q26 26 38 26 L52 26 L52 34 L40 34 Q34 34 34 40 L34 52 L26 52 Z M26 90 Q26 102 38 102 L52 102 L52 94 L40 94 Q34 94 34 88 L34 76 L26 76 Z M102 90 Q102 102 90 102 L76 102 L76 94 L88 94 Q94 94 94 88 L94 76 L102 76 Z"
          />
          <path fill="#f5f1e8" d="M64 40 C67 52, 76 61, 88 64 C76 67, 67 76, 64 88 C61 76, 52 67, 40 64 C52 61, 61 52, 64 40 Z" />
          <g fill="#ffffff">
            <ellipse cx="84" cy="40" rx="8" ry="7" />
            <ellipse cx="95" cy="35" rx="10" ry="9" />
            <ellipse cx="104" cy="40" rx="7" ry="6" />
            <rect x="80" y="38" width="28" height="9" rx="4" />
          </g>
        </svg>
        <span className="min-w-0 flex-1 break-words font-serif text-[19px] italic leading-tight text-[#dd6936]">{message}</span>
        <span className="text-[14px] text-[#8a8378]" aria-hidden>
          ×
        </span>
      </div>
      <span className="mt-2.5 block rounded-full bg-[#dd6936] py-2 text-center font-mono text-[12.5px] font-medium text-white">Brief it</span>
    </div>
  );
}

/** Send the reminder now: to these people (`userIds`), or to everyone. */
export async function sendPush(userIds?: string[]): Promise<string | null> {
  const res = await fetch("/api/admin/nudge/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(userIds ? { userIds } : {}),
  }).catch(() => null);
  return res?.ok ? ((await res.json()) as { at: string }).at : null;
}

/** "Show to everyone", with what happened to the last one. */
export function EveryoneRow({ last }: { last: { at: string; shown: number; closed: number; briefed: number } | null }) {
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [sentAt, setSentAt] = useState<string | null>(null);

  async function push() {
    if (!confirm("Show the reminder to everyone on their next page load?")) return;
    setState("sending");
    const at = await sendPush();
    if (!at) return setState("error");
    setSentAt(at);
    setState("idle");
  }

  const line =
    state === "error"
      ? "Not sent"
      : sentAt
        ? `Sent ${whenParis(sentAt)}`
        : last
          ? `Last sent ${whenParis(last.at)} · ${last.shown} saw it · ${last.closed} closed · ${last.briefed} briefed`
          : null;
  return (
    <div className="card mt-4 flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="text-[14px] text-ink">Everyone</p>
        {line && <p className={`text-[13px] ${state === "error" ? "text-[#c62828]" : "text-muted"}`}>{line}</p>}
      </div>
      <button type="button" onClick={push} disabled={state === "sending"} className="btn">
        Show to everyone
      </button>
    </div>
  );
}

export default function NudgeAdmin({ saved, children }: { saved: NudgeText; children?: React.ReactNode }) {
  const [message, setMessage] = useState(saved.message);
  const [stored, setStored] = useState(saved.message);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const dirty = message.trim() !== stored;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    const res = await fetch("/api/admin/nudge", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    }).catch(() => null);
    const data = res?.ok ? ((await res.json()) as NudgeText) : null;
    if (!data) return setState("error");
    setStored(data.message);
    setMessage(data.message);
    setState("idle");
  }

  return (
    <section>
      <h1 className="page-title">Bug card</h1>

      <div className="card mt-6 grid place-items-center bg-hairline/30 py-8">
        <CardPreview message={message.trim() || DEFAULT_MESSAGE} />
      </div>

      <form onSubmit={save} className="card mt-4 flex items-end gap-3 p-4">
        <label className="grid min-w-0 flex-1 gap-1 text-[13px] text-muted">
          Text
          <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={MAX_MESSAGE} placeholder={DEFAULT_MESSAGE} className={inputClass} />
        </label>
        <button type="submit" disabled={!dirty || state === "saving"} className="btn-accent">
          Save
        </button>
      </form>
      {state === "error" && <p className="mt-2 text-[13px] text-[#c62828]">Not saved</p>}

      {children}
    </section>
  );
}

/** "Show the reminder" for one person (their Activity page). */
export function PushCardButton({ userId, last, label }: { userId: string; last: string | null; label: string }) {
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [at, setAt] = useState(last);

  async function push() {
    setState("sending");
    const sent = await sendPush([userId]);
    if (!sent) return setState("error");
    setAt(sent);
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
