"use client";

import { useEffect, useRef, useState } from "react";
import { parseAssistantStream } from "@/lib/chat-stream";

/**
 * The brief page's assistant: a chat rail for iterating on the draft fast
 * ("tighten it", "add repro steps", "translate to English"). Powered by a fast
 * model; the revised ticket streams INTO the document in real time, so it feels
 * like a collaborator rewriting next to you rather than a form submit.
 *
 * Talks to TicketDoc (a separate client island) via window events:
 *   brief:doc:get    → asks the editor for the current title/body markdown
 *   brief:doc:stream → applies a partial rewrite as it streams (with caret)
 *   brief:doc:done   → final content: settle animation + save baseline update
 *   brief:doc:cancel → restore the pre-edit snapshot (stream failed midway)
 */
type Msg = { role: "user" | "assistant"; content: string; edited?: boolean };

const SUGGESTIONS = ["Tighten it up", "Add repro steps", "More technical", "Friendlier tone"];

function currentDoc(): Promise<{ title: string; body: string }> {
  return new Promise((resolve) => {
    window.dispatchEvent(
      new CustomEvent("brief:doc:get", { detail: { reply: resolve } }),
    );
    // If no editor answered (shouldn't happen), don't hang the send.
    setTimeout(() => resolve({ title: "", body: "" }), 400);
  });
}

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
    let hadTicket = false;
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
      let last: ReturnType<typeof parseAssistantStream> | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        last = parseAssistantStream(acc);
        note = last.note;
        setLiveNote(last.note);
        if (last.ticket) {
          hadTicket = true;
          setLiveEditing(true);
          window.dispatchEvent(new CustomEvent("brief:doc:stream", { detail: last.ticket }));
        }
      }

      // Finalize: hand the editor the complete rewrite (settle + save baseline).
      if (hadTicket && last?.ticket) {
        window.dispatchEvent(new CustomEvent("brief:doc:done", { detail: last.ticket }));
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: note || (hadTicket ? "Done." : "…"), edited: hadTicket },
      ]);
    } catch {
      if (hadTicket) window.dispatchEvent(new CustomEvent("brief:doc:cancel"));
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
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" className="text-accent" aria-hidden="true">
          <path d="M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9z" />
        </svg>
        <span className="text-sm text-ink">Assistant</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !busy && (
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                className="rounded-full border border-hairline bg-cream/50 px-2.5 py-1 text-xs text-ink-2 transition-colors hover:border-accent/50 hover:bg-accent/10 hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="chat-pop flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-3 py-2 text-[0.8125rem] leading-relaxed text-cream">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="chat-pop flex flex-col items-start gap-1">
              <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-cream-2/60 px-3 py-2 text-[0.8125rem] leading-relaxed text-ink-2">
                {m.content}
              </div>
              {m.edited && (
                <span className="inline-flex items-center gap-1 pl-1 text-[0.6875rem] text-accent">
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12l5 5L20 6" />
                  </svg>
                  Ticket updated
                </span>
              )}
            </div>
          ),
        )}

        {/* In-flight assistant turn */}
        {busy && (
          <div className="chat-pop flex flex-col items-start gap-1">
            {liveNote ? (
              <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-cream-2/60 px-3 py-2 text-[0.8125rem] leading-relaxed text-ink-2">
                {liveNote}
              </div>
            ) : (
              <div className="chat-think flex items-center gap-1 rounded-2xl rounded-bl-md bg-cream-2/60 px-3 py-2.5">
                <i /><i /><i />
              </div>
            )}
            {liveEditing && (
              <span className="inline-flex items-center gap-1.5 pl-1 text-[0.6875rem] text-accent">
                <span className="dot-pulse h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                Rewriting the ticket…
              </span>
            )}
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
            className="max-h-28 min-h-[38px] flex-1 resize-none rounded-xl border border-hairline bg-white/70 px-3 py-2 text-[0.8125rem] leading-relaxed text-ink outline-none transition-colors placeholder:text-muted focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
            aria-label="Send"
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-accent text-cream transition hover:brightness-95 disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
