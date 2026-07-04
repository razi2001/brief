"use client";

import { useRef, useState } from "react";
import ProgressCycler, { FILING_STEPS, WRITING_STEPS } from "./ProgressCycler";
import { TrackerLogo } from "./TrackerLogo";
import { CURSOR_SENTINEL, locateEdit, parseAssistantStream, type EditOp } from "@/lib/chat-stream";

/**
 * The assistant rail - the AUTHOR of the ticket, present on the owner's brief
 * from the first frame so the layout never reflows around it.
 *
 * It's a COMMAND TOOL, not a chat transcript: you tell it what to change, the
 * edits type themselves into the document, and the rail shows exactly ONE
 * status line - the current thing - which replaces itself each run. The
 * document is the record of what happened; the only "history" worth keeping is
 * the ability to UNDO the last change, which lives right here.
 *
 * Four moods:
 *   writing → it's writing the draft: raining cloud + cycling status
 *   ready   → command box; edits type into the doc; last change is undoable
 *   filing  → it's filing to the tracker: filing status
 *   filed   → the record: "Filed to Linear" + open link
 *
 * Talks to TicketDoc (a separate client island) via window events:
 *   brief:doc:get    → current title/body markdown
 *   brief:doc:stream → partial doc; CURSOR_SENTINEL marks the typing position
 *   brief:doc:done   → final content: settle animation + save baseline
 *   brief:doc:set    → set to a snapshot (undo/redo), flash + baseline
 *   brief:doc:cancel → restore the pre-edit snapshot (stream failed midway)
 */
export type ChatMode = "writing" | "ready" | "filing" | "filed";

type Doc = { title: string; body: string };
type Last =
  | { kind: "edit"; summary: string; before: Doc; after: Doc }
  | { kind: "answer"; text: string }
  | { kind: "none"; text: string }
  | { kind: "error" };

const SUGGESTIONS = ["Tighten it up", "Add repro steps", "More technical", "Friendlier tone"];

function currentDoc(): Promise<Doc> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent("brief:doc:get", { detail: { reply: resolve } }));
    setTimeout(() => resolve({ title: "", body: "" }), 400);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The AI signifier - a sparkle (matches the Brief mark), not a mascot. */
function Spark({ className = "", size = 14 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9z" />
    </svg>
  );
}

export default function TicketChat({
  briefId,
  mode = "ready",
  ticketUrl,
  providerName = "Linear",
}: {
  briefId: string;
  mode?: ChatMode;
  ticketUrl?: string | null;
  providerName?: string;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveNote, setLiveNote] = useState("");
  const [editingDoc, setEditingDoc] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [undone, setUndone] = useState(false);
  const [undoBusy, setUndoBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  // A little conversational memory (last few turns) so follow-ups like "shorter"
  // or "do the same for Expected" have context - even though the UI shows no
  // transcript. Not the document (the route always gets the live doc); just the
  // recent back-and-forth.
  const history = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);

  async function persistDoc(doc: Doc) {
    await fetch(`/api/briefs/${briefId}/edit`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: doc.title, body: doc.body }),
    });
  }

  async function undoRedo(to: Doc, nextUndone: boolean) {
    if (undoBusy) return;
    setUndoBusy(true);
    window.dispatchEvent(new CustomEvent("brief:doc:set", { detail: to }));
    try {
      await persistDoc(to);
      setUndone(nextUndone);
    } catch {
      /* leave state as-is; the doc still shows the attempted content */
    } finally {
      setUndoBusy(false);
    }
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy || mode !== "ready") return;
    setInput("");
    setBusy(true);
    cancelled.current = false;
    setLiveNote("");
    setEditingDoc(false);
    setLast(null);
    setUndone(false);

    const before = await currentDoc();
    const state = { body: before.body, title: null as string | null, ok: 0, fail: 0 };
    let rewrote = false;
    let hadChange = false;
    let finalTicket: { title: string | null; body: string } | null = null;
    let queue: Promise<void> = Promise.resolve();
    let note = "";

    const dispatchStream = (bodyMd: string) =>
      window.dispatchEvent(
        new CustomEvent("brief:doc:stream", { detail: { title: state.title, body: bodyMd, caret: false } }),
      );

    // Type one edit into the doc: the replacement reveals a few chars at a time
    // at its own position, caret riding along.
    const typeEdit = async (op: EditOp) => {
      if (cancelled.current) return;
      const loc = locateEdit(state.body, op);
      if (!loc) {
        state.fail++;
        return;
      }
      hadChange = true;
      setEditingDoc(true);
      const b = state.body.slice(0, loc.index);
      const a = state.body.slice(loc.index + loc.length);
      const t = op.replace;
      const chunk = Math.max(2, Math.ceil(t.length / 50));
      for (let k = chunk; k < t.length; k += chunk) {
        if (cancelled.current) return;
        dispatchStream(b + t.slice(0, k) + CURSOR_SENTINEL + a);
        await sleep(18);
      }
      state.body = b + t + a;
      state.ok++;
      dispatchStream(state.body);
    };

    try {
      // Send the last 2 turns of context + this instruction. The route always
      // also gets the CURRENT document, so this is purely for referential
      // follow-ups ("shorter", "same for Expected", "undo that phrasing").
      const messages = [...history.current.slice(-4), { role: "user" as const, content: q }];
      const res = await fetch(`/api/briefs/${briefId}/chat`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages, title: before.title, body: before.body }),
      });
      if (!res.ok || !res.body) throw new Error(String(res.status));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      let queued = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const p = parseAssistantStream(acc);
        note = p.note;
        setLiveNote(p.note);

        if (p.ticket) {
          rewrote = true;
          hadChange = true;
          setEditingDoc(true);
          finalTicket = p.ticket;
          window.dispatchEvent(new CustomEvent("brief:doc:stream", { detail: { ...p.ticket, caret: true } }));
          continue;
        }
        while (queued < p.edits.length) {
          const op = p.edits[queued++];
          queue = queue.then(() => typeEdit(op));
        }
        if (p.title && p.title !== state.title) {
          const t = p.title;
          queue = queue.then(() => {
            state.title = t;
            hadChange = true;
            setEditingDoc(true);
            dispatchStream(state.body);
          });
        }
      }
      await queue;

      if (hadChange) {
        const after: Doc = finalTicket
          ? { title: finalTicket.title || before.title, body: finalTicket.body }
          : { title: state.title || before.title, body: state.body };
        window.dispatchEvent(new CustomEvent("brief:doc:done", { detail: finalTicket ?? { title: state.title, body: state.body } }));
        const bits: string[] = [];
        if (rewrote) bits.push("Rewrote the ticket");
        else if (state.ok > 0) bits.push(`${state.ok} change${state.ok > 1 ? "s" : ""}`);
        if (!rewrote && state.title) bits.push("title");
        setLast({ kind: "edit", summary: bits.join(" · ") || "Updated", before, after });
      } else if (note) {
        setLast({ kind: "answer", text: note });
      } else {
        setLast({ kind: "none", text: "No changes needed." });
      }
      // Remember this turn for follow-up context (kept short).
      history.current = [
        ...history.current,
        { role: "user" as const, content: q },
        { role: "assistant" as const, content: note || (hadChange ? "Applied the requested change." : "No change made.") },
      ].slice(-8);
    } catch {
      cancelled.current = true;
      if (hadChange) window.dispatchEvent(new CustomEvent("brief:doc:cancel"));
      setLast({ kind: "error" });
    } finally {
      setBusy(false);
      setLiveNote("");
      setEditingDoc(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  const showChips = mode === "ready" && !busy && !last;
  const composerDisabled = busy || mode !== "ready";

  const working = mode === "writing" || mode === "filing" || (mode === "ready" && busy);

  return (
    <aside className="ai-float chat-pop fixed inset-x-4 bottom-4 z-40 overflow-hidden rounded-2xl border border-hairline bg-[#fffdf9]/95 font-sans backdrop-blur-md transition-[border-color,box-shadow] focus-within:border-accent/50 focus-within:shadow-[0_0_0_3px_rgba(221,105,54,0.10),0_20px_50px_-18px_rgba(26,22,18,0.30)] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[370px]">
      {mode === "filed" ? (
        // The quiet record: where it lives now.
        <div className="flex flex-col gap-3 p-4">
          <span className="inline-flex items-center gap-2 text-[0.8125rem] text-ink-2">
            <span className="inline-block h-2 w-2 rounded-full bg-[#2e7d32]" aria-hidden />
            Filed to {providerName}
          </span>
          {ticketUrl && (
            <a
              href={ticketUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-hairline bg-cream/50 px-3 py-1.5 text-xs text-ink-2 no-underline transition-colors hover:bg-cream-2/70 hover:text-ink"
            >
              <TrackerLogo kind={providerName.toLowerCase()} size={13} />
              Open in {providerName}
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-muted" aria-hidden="true">
                <path d="M7 17 17 7M8 7h9v9" />
              </svg>
            </a>
          )}
        </div>
      ) : (
        <>
          {/* The input IS the assistant - it lives directly in the card (no
              box-in-box); the whole card gets the focus ring. */}
          <div className="group flex items-end gap-2.5 px-3.5 py-3">
            <Spark
              className={`mt-1 shrink-0 ${working ? "ai-spark text-accent" : "text-muted transition-colors group-focus-within:text-accent"}`}
            />
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              disabled={composerDisabled}
              placeholder={
                mode === "writing"
                  ? "Writing your ticket…"
                  : mode === "filing"
                    ? "Filing to your tracker…"
                    : "Ask AI to edit the ticket…"
              }
              className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent py-0.5 text-[0.8125rem] leading-relaxed text-ink outline-none placeholder:text-muted disabled:opacity-70"
            />
            <button
              type="button"
              onClick={() => void send(input)}
              disabled={composerDisabled || !input.trim()}
              aria-label="Send"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition ${
                input.trim() && !composerDisabled ? "bg-accent text-cream hover:brightness-95" : "bg-cream-2 text-muted/50"
              }`}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>

          {/* Idle → gentle prompts. */}
          {showChips && (
            <div className="flex flex-wrap gap-1 border-t border-hairline px-3 py-2.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-accent/10 hover:text-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Working → a clean shimmer + a moving status line (no mascot). */}
          {working && (
            <div className="border-t border-hairline px-4 py-3.5">
              <div className="ai-bar" />
              <div className="mt-2.5">
                {mode === "ready" ? (
                  liveNote ? (
                    <p className="text-xs leading-relaxed text-ink-2">{liveNote}</p>
                  ) : (
                    <p className="text-xs text-muted">Thinking…</p>
                  )
                ) : (
                  <ProgressCycler
                    bare
                    messages={mode === "writing" ? WRITING_STEPS : FILING_STEPS}
                    className="text-xs"
                  />
                )}
                {editingDoc && (
                  <span className="mt-1.5 flex items-center gap-1.5 text-[0.6875rem] text-accent">
                    <span className="dot-pulse h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                    Writing into your ticket…
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Result of the last instruction → one line, undoable. */}
          {mode === "ready" && !busy && last && (
            <div className="border-t border-hairline px-4 py-3">
              {last.kind === "edit" ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-ink-2">
                    {undone ? (
                      <>
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted" aria-hidden="true">
                          <path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" />
                        </svg>
                        <span className="truncate text-muted">Reverted</span>
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#2e7d32" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
                          <path d="M5 12l5 5L20 6" />
                        </svg>
                        <span className="truncate">{last.summary}</span>
                      </>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => undoRedo(undone ? last.after : last.before, !undone)}
                    disabled={undoBusy}
                    className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
                  >
                    {undone ? "Redo" : "Undo"}
                  </button>
                </div>
              ) : last.kind === "answer" ? (
                <p className="text-[0.8125rem] leading-relaxed text-ink-2">{last.text}</p>
              ) : last.kind === "none" ? (
                <p className="text-xs text-muted">{last.text}</p>
              ) : (
                <p className="text-xs text-[#c62828]">That didn&apos;t go through - try again.</p>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
