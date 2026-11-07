"use client";

import { useMemo, useState } from "react";
import Avatar from "./Avatar";
import { sendPush, whenParis } from "./NudgeAdmin";
import { fieldFocusClass } from "./SettingsSection";
import { ago } from "@/lib/activity";
import type { CardStatus } from "@/lib/nudge";
import type { CardPerson } from "@/lib/nudge-server";

export type { CardPerson };

const inputClass = `block w-full rounded-lg border hairline bg-surface px-3 py-2 text-[14px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted/60 ${fieldFocusClass}`;

const STATUS_LABEL: Record<CardStatus, string> = { sent: "Sent", shown: "Saw it", closed: "Closed it", briefed: "Briefed" };
const STATUS_CLASS: Record<CardStatus, string> = {
  sent: "bg-hairline/60 text-muted",
  shown: "bg-[#eef3fb] text-[#2f5b9a]",
  closed: "bg-hairline/60 text-ink-2",
  briefed: "bg-[#e9f6ee] text-[#23794a]",
};

/**
 * Everyone, paired browsers first: pick people and show them the reminder, and
 * see what each did with the last one sent to them. Only a paired extension
 * can show it.
 */
export default function NudgePeople({ people: initial, now }: { people: CardPerson[]; now: number }) {
  const [people, setPeople] = useState(initial);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return people.filter((p) => !s || p.name.toLowerCase().includes(s) || (p.email ?? "").toLowerCase().includes(s));
  }, [people, q]);
  const pickable = shown.filter((p) => p.extension);
  const allPicked = pickable.length > 0 && pickable.every((p) => picked.has(p.id));

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setPicked((s) => {
      const n = new Set(s);
      for (const p of pickable) {
        if (allPicked) n.delete(p.id);
        else n.add(p.id);
      }
      return n;
    });

  async function send() {
    const ids = [...picked];
    setState("sending");
    const at = await sendPush(ids);
    if (!at) return setState("error");
    setPeople((list) => list.map((p) => (picked.has(p.id) ? { ...p, card: { at, status: "sent" } } : p)));
    setPicked(new Set());
    setState("idle");
  }

  return (
    <div className="card mt-4 overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-3 border-b hairline p-4">
        <input
          type="checkbox"
          checked={allPicked}
          onChange={toggleAll}
          disabled={pickable.length === 0}
          aria-label="Pick everyone shown"
          className="h-4 w-4 accent-[#dd6936]"
        />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search people" className={`${inputClass} min-w-0 flex-1`} />
        <button type="button" onClick={send} disabled={picked.size === 0 || state === "sending"} className="btn-accent shrink-0">
          {picked.size ? `Show to ${picked.size}` : "Show"}
        </button>
        {state === "error" && <span className="text-[13px] text-[#c62828]">Not sent</span>}
      </div>
      <ul className="divide-y divide-hairline">
        {shown.map((p) => (
          <li key={p.id}>
            <label className={`flex items-center gap-3 px-4 py-2.5 ${p.extension ? "cursor-pointer" : ""}`}>
              <input
                type="checkbox"
                checked={picked.has(p.id)}
                onChange={() => toggle(p.id)}
                disabled={!p.extension}
                aria-label={`Pick ${p.name || p.email}`}
                className="h-4 w-4 accent-[#dd6936]"
              />
              <Avatar name={p.name || p.email || "?"} imageUrl={p.image ?? undefined} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-ink">{p.name || p.email}</span>
                <span className="block truncate text-[12px] text-muted">
                  {[p.name ? p.email : null, p.lastSeen ? `seen ${ago(p.lastSeen, now)}` : null, p.extension ? null : "no extension"]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {p.card && (
                <span className="flex shrink-0 items-center gap-2">
                  <span className="hidden text-[12px] text-muted sm:inline">{whenParis(p.card.at)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${STATUS_CLASS[p.card.status]}`}>{STATUS_LABEL[p.card.status]}</span>
                </span>
              )}
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-muted">No one</li>}
      </ul>
    </div>
  );
}
