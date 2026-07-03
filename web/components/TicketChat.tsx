"use client";

import { useEffect, useRef, useState } from "react";
import { applyEdit, parseAssistantStream } from "@/lib/chat-stream";

/**
 * The brief page's assistant: a chat rail for iterating on the draft fast
 * ("tighten it", "add repro steps", "translate to English"). Powered by a fast
 * model. The model answers with TARGETED edits that are applied to the doc in
 * place, one by one, as they stream in - a collaborator touching just the
 * lines you asked about, not retyping the page. Full rewrites only happen for
 * restructures.
 *
 * Talks to TicketDoc (a separate client island) via window events:
 *   brief:doc:get    → asks the editor for the current title/body markdown
 *   brief:doc:stream → applies a revision (caret:false = in-place edit swap,
 *                      caret:true = full rewrite streaming with a caret)
 *   brief:doc:done   → final content: settle animation + save baseline update
 *   brief:doc:cancel → restore the pre-edit snapshot (stream failed midway)
 */
type Activity = { edits: number; failed: number; rewrote: boolean; retitled: boolean };
type Msg = { role: "user" | "assistant"; content: string; activity?: Activity };

const SUGGESTIONS = ["Tighten it up", "Add repro steps", "More technical", "Friendlier tone"];

function currentDoc(): Promise<{ title: string; body: string }> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent("brief:doc:get", { detail: { reply: resolve } }));
    // If no editor answered (shouldn't happen), don't hang the send.
    setTimeout(() => resolve({ title: "", body: "" }), 400);
  });
}

function activityLabel(a: Activity): string {
  if (a.rewrote) return "Rewrote the ticket";
  const parts: string[] = [];
  if (a.edits > 0) parts.push(`${a.edits} edit${a.edits > 1 ? "s" : ""}`);
  if (a.retitled) parts.push("title");
  if (!parts.length) return "";
  return parts.join(" · ");
}

const SPARK = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
    <path d="M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9z" />
  </svg>
);

export default function TicketChat({ briefId }: { briefId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Live view of the in-flight assistant turn.
  const [liveNote, setLiveNote] = useState("");
  const [liveEditing, setLiveEditing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, liveNote, liveEditing]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setLiveNote("");
    setLiveEditing(false);
    const history: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(history);

    const doc = await currentDoc();
    // The working copy the streamed ops mutate, block by block.
    let workingTitle: string | null = null;
    let workingBody = doc.body;
    let appliedCount = 0;
    let okCount = 0;
    let failedCount = 0;
    let rewrote = false;
    let hadChange = false;
    let note = "";
    try {
      const res = await fetch(`/api/briefs/${briefId}/chat`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          title: doc.title,
          body: doc.body,
        }),
      });
      if (!res.ok || !res.body) throw new Error(String(res.status));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      let finalTicket: { title: string | null; body: string } | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const p = parseAssistantStream(acc);
        note = p.note;
        setLiveNote(p.note);

        if (p.ticket) {
          // Full rewrite: stream it top-to-bottom with the typing caret.
          rewrote = true;
          hadChange = true;
          finalTicket = p.ticket;
          setLiveEditing(true);
          window.dispatchEvent(
            new CustomEvent("brief:doc:stream", { detail: { ...p.ticket, caret: true } }),
          );
          continue;
        }

        // Targeted ops: apply each completed edit ONCE, in place.
        let touched = false;
        while (appliedCount < p.edits.length) {
          const r = applyEdit(workingBody, p.edits[appliedCount]);
          workingBody = r.md;
          if (r.ok) {
            okCount++;
            touched = true;
          } else {
            failedCount++;
          }
          appliedCount++;
        }
        if (p.title && p.title !== workingTitle) {
          workingTitle = p.title;
          touched = true;
        }
        if (touched) {
          hadChange = true;
          setLiveEditing(true);
          window.dispatchEvent(
            new CustomEvent("brief:doc:stream", {
              detail: { title: workingTitle, body: workingBody, caret: false },
            }),
          );
        }
      }

      // Finalize: hand the editor the complete result (settle + save baseline).
      if (hadChange) {
        window.dispatchEvent(
          new CustomEvent("brief:doc:done", {
            detail: finalTicket ?? { title: workingTitle, body: workingBody },
          }),
        );
      }
      const activity: Activity = { edits: okCount, failed: failedCount, rewrote, retitled: !!workingTitle };
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: note || (hadChange ? "Done." : "…"),
          activity: hadChange || failedCount > 0 ? activity : undefined,
        },
      ]);
    } catch {
      if (hadChange) window.dispatchEvent(new CustomEvent("brief:doc:cancel"));
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Something went wrong - try again." },
      ]);
    } finally {
      setBusy(false);
      setLiveNote("");
      setLiveEditing(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  return (
    <aside className="card chat-pop mt-5 flex max-h-[80vh] flex-col p-0 font-sans lg:sticky lg:top-6 lg:mt-0">
      {/* Header */}
      <div className="flex h-11 items-center gap-2 border-b border-hairline px-4">
        <span className="text-accent">{SPARK}</span>
        <span className="text-[0.8125rem] font-medium text-ink">Assistant</span>
        {messages.length > 0 && !busy && (
          <button
            type="button"
            onClick={() => setMessages([])}
            title="Clear conversation"
            aria-label="Clear conversation"
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-cream-2/70 hover:text-ink"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.4 2.6L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        )}
      </div>

      {/* Thread */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-3.5 py-4">
        {messages.length === 0 && !busy && (
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                className="rounded-md border border-hairline bg-cream/50 px-2.5 py-1.5 text-xs text-ink-2 transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="chat-pop flex justify-end">
              <div className="max-w-[88%] rounded-lg bg-ink px-2.5 py-1.5 text-[0.8125rem] leading-relaxed text-cream">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="chat-pop flex gap-2">
              <span className="mt-1 shrink-0 text-accent/80">{SPARK}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.8125rem] leading-relaxed text-ink-2">{m.content}</p>
                {m.activity && (activityLabel(m.activity) || m.activity.failed > 0) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {activityLabel(m.activity) && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-hairline bg-cream/60 px-1.5 py-0.5 text-[0.6875rem] text-ink-2">
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#2e7d32" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M5 12l5 5L20 6" />
                        </svg>
                        {activityLabel(m.activity)}
                      </span>
                    )}
                    {m.activity.failed > 0 && (
                      <span className="text-[0.6875rem] text-muted">
                        {m.activity.failed} couldn&apos;t apply
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ),
        )}

        {/* In-flight assistant turn */}
        {busy && (
          <div className="chat-pop flex gap-2">
            <span className="mt-1 shrink-0 text-accent/80">{SPARK}</span>
            <div className="min-w-0 flex-1">
              {liveNote ? (
                <p className="text-[0.8125rem] leading-relaxed text-ink-2">{liveNote}</p>
              ) : (
                <span className="chat-think inline-flex items-center gap-1 py-1.5">
                  <i /><i /><i />
                </span>
              )}
              {liveEditing && (
                <span className="mt-1.5 inline-flex items-center gap-1.5 text-[0.6875rem] text-accent">
                  <span className="dot-pulse h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                  Editing the ticket…
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-hairline p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask for changes…"
            className="max-h-28 min-h-[36px] flex-1 resize-none rounded-lg border border-hairline bg-white/70 px-2.5 py-2 text-[0.8125rem] leading-relaxed text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_rgba(221,105,54,0.12)]"
          />
          <button
            type="button"
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
            aria-label="Send"
            className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-lg bg-accent text-cream transition hover:brightness-95 disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
