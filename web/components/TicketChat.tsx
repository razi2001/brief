"use client";

import { useRef, useState } from "react";
import { CURSOR_SENTINEL, locateEdit, parseAssistantStream, type EditOp } from "@/lib/chat-stream";

/**
 * The brief page's assistant rail - NOT a chat. One command box: tell it what
 * to change ("tighten it", "add repro steps") and the edits TYPE THEMSELVES
 * into the document at the right spot, caret riding the insertion point, like
 * a collaborator writing mid-page. Below the box, a quiet activity log of what
 * each instruction did ("✓ 2 edits"). Each instruction is independent - it
 * acts on the document as it stands now.
 *
 * Talks to TicketDoc (a separate client island) via window events:
 *   brief:doc:get    → current title/body markdown
 *   brief:doc:stream → partial doc; CURSOR_SENTINEL marks the typing position
 *   brief:doc:done   → final content: settle animation + save baseline update
 *   brief:doc:cancel → restore the pre-edit snapshot (stream failed midway)
 */
type Activity = { edits: number; failed: number; rewrote: boolean; retitled: boolean };
type Run = {
  instruction: string;
  note: string;
  activity?: Activity;
  error?: boolean;
  live?: boolean;
};

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
  return parts.join(" · ");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SPARK = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
    <path d="M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9z" />
  </svg>
);

export default function TicketChat({ briefId }: { briefId: string }) {
  const [runs, setRuns] = useState<Run[]>([]); // newest first
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);

  const patchLiveRun = (patch: Partial<Run>) =>
    setRuns((prev) => (prev.length ? [{ ...prev[0], ...patch }, ...prev.slice(1)] : prev));

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    cancelled.current = false;
    setRuns((prev) => [{ instruction: q, note: "", live: true }, ...prev]);

    const doc = await currentDoc();
    // The working copy the streamed ops mutate. Mutated ONLY inside the typing
    // queue, so edits land in order even when the model outruns the animation.
    const state = { body: doc.body, title: null as string | null, ok: 0, fail: 0 };
    let rewrote = false;
    let hadChange = false;
    let finalTicket: { title: string | null; body: string } | null = null;
    let queue: Promise<void> = Promise.resolve();

    const dispatchStream = (bodyMd: string) =>
      window.dispatchEvent(
        new CustomEvent("brief:doc:stream", {
          detail: { title: state.title, body: bodyMd, caret: false },
        }),
      );

    // Type one edit into the doc: the replacement reveals a few characters at
    // a time at its own position, sentinel caret riding along.
    const typeEdit = async (op: EditOp) => {
      if (cancelled.current) return;
      const loc = locateEdit(state.body, op);
      if (!loc) {
        state.fail++;
        return;
      }
      hadChange = true;
      const before = state.body.slice(0, loc.index);
      const after = state.body.slice(loc.index + loc.length);
      const text = op.replace;
      const chunk = Math.max(2, Math.ceil(text.length / 50)); // ≤ ~0.9s per edit
      for (let k = chunk; k < text.length; k += chunk) {
        if (cancelled.current) return;
        dispatchStream(before + text.slice(0, k) + CURSOR_SENTINEL + after);
        await sleep(18);
      }
      state.body = before + text + after;
      state.ok++;
      dispatchStream(state.body);
    };

    try {
      const res = await fetch(`/api/briefs/${briefId}/chat`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        // One instruction, no conversation - it acts on the current doc.
        body: JSON.stringify({
          messages: [{ role: "user", content: q }],
          title: doc.title,
          body: doc.body,
        }),
      });
      if (!res.ok || !res.body) throw new Error(String(res.status));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      let queuedEdits = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const p = parseAssistantStream(acc);
        patchLiveRun({ note: p.note });

        if (p.ticket) {
          // Full rewrite: stream it top-to-bottom with the trailing caret.
          rewrote = true;
          hadChange = true;
          finalTicket = p.ticket;
          window.dispatchEvent(
            new CustomEvent("brief:doc:stream", { detail: { ...p.ticket, caret: true } }),
          );
          continue;
        }

        // Queue newly-completed ops; the typewriter plays them in order.
        while (queuedEdits < p.edits.length) {
          const op = p.edits[queuedEdits++];
          queue = queue.then(() => typeEdit(op));
        }
        if (p.title && p.title !== state.title) {
          const t = p.title;
          queue = queue.then(() => {
            state.title = t;
            hadChange = true;
            dispatchStream(state.body);
          });
        }
      }

      await queue; // let the typing animation finish

      if (hadChange) {
        window.dispatchEvent(
          new CustomEvent("brief:doc:done", {
            detail: finalTicket ?? { title: state.title, body: state.body },
          }),
        );
      }
      const p = parseAssistantStream(acc);
      patchLiveRun({
        live: false,
        note: p.note,
        activity:
          hadChange || state.fail > 0
            ? { edits: state.ok, failed: state.fail, rewrote, retitled: !!state.title }
            : undefined,
      });
    } catch {
      cancelled.current = true;
      if (hadChange) window.dispatchEvent(new CustomEvent("brief:doc:cancel"));
      patchLiveRun({ live: false, error: true, note: "" });
    } finally {
      setBusy(false);
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
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-hairline px-4">
        <span className="text-accent">{SPARK}</span>
        <span className="text-[0.8125rem] font-medium text-ink">Assistant</span>
        {runs.length > 0 && !busy && (
          <button
            type="button"
            onClick={() => setRuns([])}
            title="Clear history"
            aria-label="Clear history"
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-cream-2/70 hover:text-ink"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.4 2.6L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        )}
      </div>

      {/* Command box */}
      <div className="shrink-0 p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            disabled={busy}
            placeholder="Tell it what to change…"
            className="max-h-28 min-h-[36px] flex-1 resize-none rounded-lg border border-hairline bg-white/70 px-2.5 py-2 text-[0.8125rem] leading-relaxed text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_rgba(221,105,54,0.12)] disabled:opacity-60"
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
        {runs.length === 0 && !busy && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
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
      </div>

      {/* Activity log (newest first) */}
      {runs.length > 0 && (
        <div className="flex-1 space-y-4 overflow-y-auto border-t border-hairline px-4 py-3.5">
          {runs.map((r, i) => (
            <div key={runs.length - i} className={i === 0 ? "chat-pop" : undefined}>
              <p className="text-[0.8125rem] font-medium leading-snug text-ink">{r.instruction}</p>
              {r.live ? (
                <div className="mt-1">
                  {r.note ? (
                    <p className="text-xs leading-relaxed text-muted">{r.note}</p>
                  ) : (
                    <span className="chat-think inline-flex items-center gap-1 py-1">
                      <i /><i /><i />
                    </span>
                  )}
                  <span className="mt-1 inline-flex items-center gap-1.5 text-[0.6875rem] text-accent">
                    <span className="dot-pulse h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                    Editing…
                  </span>
                </div>
              ) : (
                <div className="mt-1">
                  {r.note && <p className="text-xs leading-relaxed text-muted">{r.note}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {r.error ? (
                      <span className="text-[0.6875rem] text-[#c62828]">Didn&apos;t go through - try again</span>
                    ) : r.activity && activityLabel(r.activity) ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-hairline bg-cream/60 px-1.5 py-0.5 text-[0.6875rem] text-ink-2">
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#2e7d32" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M5 12l5 5L20 6" />
                        </svg>
                        {activityLabel(r.activity)}
                      </span>
                    ) : (
                      !r.note && <span className="text-[0.6875rem] text-muted">No changes</span>
                    )}
                    {r.activity && r.activity.failed > 0 && (
                      <span className="text-[0.6875rem] text-muted">
                        {r.activity.failed} couldn&apos;t apply
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
