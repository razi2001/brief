"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProgressCycler, { FILING_STEPS, WRITING_STEPS } from "./ProgressCycler";
import { TrackerLogo } from "./TrackerLogo";
import { CURSOR_SENTINEL, locateEdit, parseAssistantStream, type EditOp } from "@/lib/chat-stream";

/**
 * The assistant - the AUTHOR of the ticket, present on the owner's brief from
 * the first frame so the layout never reflows around it.
 *
 * You tell it what to change and the edits type themselves into the document.
 * A short thread keeps the last few asks and what each one did (the document
 * stays the record; the thread is the receipt), and the latest change can be
 * undone or redone right there.
 *
 * Ways in:
 *   - the composer, or ⌘K from anywhere on the page
 *   - suggestions that read the ticket (what's missing, what's long) and
 *     follow-ups after each change
 *   - select text in the ticket: the selection toolbar's AI actions edit just
 *     that passage (TicketDoc sends them here as `brief:ai:ask`)
 *   - Stop while it's working: the document goes back to how it was
 *
 * Four moods:
 *   writing → it's writing the draft: cycling status
 *   ready   → thread + composer; edits type into the doc
 *   filing  → it's filing to the tracker: filing status
 *   filed   → the record: "Filed to Linear" + open link
 *
 * Talks to TicketDoc (a separate client island) via window events:
 *   brief:doc:get    → current title/body markdown
 *   brief:doc:stream → partial doc; CURSOR_SENTINEL marks the typing position
 *   brief:doc:done   → final content: settle animation + save baseline
 *   brief:doc:set    → set to a snapshot (undo/redo), flash + baseline
 *   brief:doc:cancel → restore the pre-edit snapshot (stream failed or stopped)
 *   brief:ai:ask     ← { prompt, quote? } from the selection toolbar
 */
export type ChatMode = "writing" | "ready" | "filing" | "filed";

type Doc = { title: string; body: string };
type Result =
  | { kind: "edit"; summary: string; before: Doc; after: Doc }
  | { kind: "answer"; text: string }
  | { kind: "none"; text: string }
  | { kind: "stopped" }
  | { kind: "error" };
type Turn = { id: number; ask: string; quote?: string; result?: Result };
type Chip = { label: string; prompt: string };

/** What the ticket could use, read from the ticket itself (short label, precise prompt). */
function suggestionsFor(doc: Doc | null): Chip[] {
  const body = doc?.body ?? "";
  // A blank draft: nothing to improve yet.
  if (!body.trim()) return [];
  const out: Chip[] = [];
  if (body && !/steps to reproduce|repro/i.test(body))
    out.push({ label: "Add repro steps", prompt: "Add a short numbered 'Steps to reproduce' section, inferred from what the ticket already says. Don't invent facts that aren't implied." });
  if (body && !/expected/i.test(body))
    out.push({ label: "Expected vs actual", prompt: "Add a brief Expected and Actual section, based only on what the ticket already says." });
  if (body.length > 1200)
    out.push({ label: "Make it concise", prompt: "Rewrite this as a short, simple ticket - a sentence or two on the problem plus only the essential detail. Drop scaffolding sections unless they're genuinely needed." });
  if ((doc?.title ?? "").length > 70)
    out.push({ label: "Shorter title", prompt: "Give it a shorter, sharper title (under 60 characters). Leave the body as is." });
  if (body && !/acceptance criteria/i.test(body))
    out.push({ label: "Acceptance criteria", prompt: "Add a short 'Acceptance criteria' checklist an engineer and QA can verify." });
  out.push(
    { label: "Improve layout", prompt: "Improve the formatting and layout: clear section headings, tight bullet or numbered lists, and code formatting for anything technical. Keep the same information." },
    { label: "More technical", prompt: "Make it more technical and specific: name the likely component or area, use precise terminology, and add the details an engineer needs to start." },
    { label: "Fix the writing", prompt: "Fix grammar, spelling and awkward phrasing only. Don't change the meaning or structure." },
  );
  return out.slice(0, 4);
}

/** After a change: the natural next moves. */
const FOLLOW_UPS: Chip[] = [
  { label: "Shorter", prompt: "Make that shorter." },
  { label: "More detail", prompt: "Add a bit more useful detail to what you just changed." },
  { label: "Say it differently", prompt: "Reword what you just changed, same meaning." },
];

function currentDoc(): Promise<Doc> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent("brief:doc:get", { detail: { reply: resolve } }));
    setTimeout(() => resolve({ title: "", body: "" }), 400);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isMac = () => typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);

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
  const [quote, setQuote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [liveNote, setLiveNote] = useState("");
  const [editingDoc, setEditingDoc] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [undone, setUndone] = useState(false);
  const [undoBusy, setUndoBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [doc, setDoc] = useState<Doc | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  // A little conversational memory (last few turns) so follow-ups like
  // "shorter" or "same for Expected" have context. The route always also gets
  // the live document.
  const history = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);

  const latest = turns[turns.length - 1];
  const latestEdit = latest?.result?.kind === "edit" ? latest.result : null;

  // Read the ticket when idle, so the suggestions fit it.
  useEffect(() => {
    if (mode !== "ready" || busy) return;
    let alive = true;
    const t = setTimeout(() => void currentDoc().then((d) => alive && setDoc(d)), 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [mode, busy, turns.length, undone]);

  // Keep the newest turn in view.
  useEffect(() => {
    const el = threadRef.current;
    el?.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns, liveNote]);

  async function persistDoc(d: Doc) {
    await fetch(`/api/briefs/${briefId}/edit`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: d.title, body: d.body }),
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

  const send = useCallback(
    async (text: string, scoped?: string | null) => {
      const ask = text.trim();
      if (!ask || busy || mode !== "ready") return;
      const passage = scoped ?? quote;
      setInput("");
      setQuote(null);
      setBusy(true);
      setOpen(true);
      cancelled.current = false;
      setLiveNote("");
      setEditingDoc(false);
      setUndone(false);
      const id = nextId.current++;
      setTurns((ts) => [...ts, { id, ask, quote: passage ?? undefined }].slice(-6));
      const finish = (result: Result) => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, result } : t)));

      // A selected passage scopes the change to just that text.
      const q = passage
        ? `${ask}\n\nOnly change this passage; leave everything else exactly as it is:\n"""${passage}"""`
        : ask;

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

      // Type one edit into the doc: the replacement reveals a few chars at a
      // time at its own position, caret riding along.
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

      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        const messages = [...history.current.slice(-4), { role: "user" as const, content: q }];
        const res = await fetch(`/api/briefs/${briefId}/chat`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages, title: before.title, body: before.body }),
          signal: ctrl.signal,
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
        if (cancelled.current) throw new DOMException("stopped", "AbortError");

        if (hadChange) {
          const after: Doc = finalTicket
            ? { title: finalTicket.title || before.title, body: finalTicket.body }
            : { title: state.title || before.title, body: state.body };
          window.dispatchEvent(new CustomEvent("brief:doc:done", { detail: finalTicket ?? { title: state.title, body: state.body } }));
          const bits: string[] = [];
          if (rewrote) bits.push("Rewrote the ticket");
          else if (state.ok > 0) bits.push(`${state.ok} change${state.ok > 1 ? "s" : ""}`);
          if (!rewrote && state.title) bits.push("new title");
          finish({ kind: "edit", summary: bits.join(" · ") || "Updated", before, after });
        } else if (note) {
          finish({ kind: "answer", text: note });
        } else {
          finish({ kind: "none", text: "No changes needed." });
        }
        history.current = [
          ...history.current,
          { role: "user" as const, content: q },
          { role: "assistant" as const, content: note || (hadChange ? "Applied the requested change." : "No change made.") },
        ].slice(-8);
      } catch (err) {
        const stopped = cancelled.current || (err instanceof DOMException && err.name === "AbortError");
        cancelled.current = true;
        if (hadChange) window.dispatchEvent(new CustomEvent("brief:doc:cancel"));
        finish(stopped ? { kind: "stopped" } : { kind: "error" });
      } finally {
        abort.current = null;
        setBusy(false);
        setLiveNote("");
        setEditingDoc(false);
        inputRef.current?.focus();
      }
    },
    [briefId, busy, mode, quote],
  );

  function stop() {
    cancelled.current = true;
    abort.current?.abort();
  }

  // The selection toolbar's AI actions: run one now, or "Ask…" to quote the
  // passage in the composer and type what to do with it.
  useEffect(() => {
    const onAsk = (e: Event) => {
      const { prompt, quote: q } = (e as CustomEvent<{ prompt?: string; quote?: string }>).detail ?? {};
      setOpen(true);
      if (prompt) void send(prompt, q ?? null);
      else {
        setQuote(q?.trim() || null);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("brief:ai:ask", onAsk);
    return () => window.removeEventListener("brief:ai:ask", onAsk);
  }, [send]);

  // ⌘K / Ctrl+K: straight to the composer from anywhere on the page.
  useEffect(() => {
    if (mode !== "ready") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    } else if (e.key === "Escape") {
      if (busy) stop();
      else if (quote) setQuote(null);
    }
  }

  const chips = useMemo(() => (latestEdit && !undone ? FOLLOW_UPS : suggestionsFor(doc)), [latestEdit, undone, doc]);
  const showChips = mode === "ready" && !busy;
  const composerDisabled = mode !== "ready";
  const working = mode === "writing" || mode === "filing" || (mode === "ready" && busy);
  const kbd = isMac() ? "⌘K" : "Ctrl K";

  // Minimized → a small pill in the corner (with a live twinkle while working).
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ai-float chat-pop fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full border border-[rgba(26,22,18,0.14)] bg-surface px-4 py-2 text-[13px] font-medium text-ink transition hover:bg-surface-2"
      >
        <Spark className={working ? "ai-spark text-accent" : "text-accent"} />
        Assistant
        {mode === "ready" && <kbd className="rounded border border-hairline px-1 font-sans text-[10px] text-muted">{kbd}</kbd>}
      </button>
    );
  }

  return (
    <aside className="ai-float chat-pop fixed inset-x-4 bottom-4 z-40 flex max-h-[70vh] flex-col overflow-hidden rounded-[14px] border border-[rgba(26,22,18,0.14)] bg-surface font-sans transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_rgba(221,105,54,0.12),0_26px_60px_-14px_rgba(26,22,18,0.4)] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[380px]">
      {/* Slim header: identity, clear, minimize. */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-hairline pl-3.5 pr-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
          <Spark className={working ? "ai-spark text-accent" : "text-accent"} size={12} />
          Assistant
        </span>
        <span className="flex items-center gap-0.5">
          {mode === "ready" && turns.length > 0 && !busy && (
            <button
              type="button"
              onClick={() => {
                setTurns([]);
                setUndone(false);
                history.current = [];
              }}
              className="rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Minimize assistant"
            title="Minimize"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </span>
      </div>

      {mode === "filed" ? (
        // The quiet record: where it lives now.
        <div className="flex flex-col gap-3 p-4">
          <span className="inline-flex items-center gap-2 text-[13px] text-ink-2">
            <span className="inline-block h-2 w-2 rounded-full bg-[#2e7d32]" aria-hidden />
            Filed to {providerName}
          </span>
          {ticketUrl && (
            <a href={ticketUrl} target="_blank" rel="noreferrer" className="btn w-fit">
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
          {/* Writing / filing the draft: the moving status. */}
          {mode !== "ready" && (
            <div className="px-4 py-3.5">
              <div className="ai-bar" />
              <div className="mt-2.5">
                <ProgressCycler bare messages={mode === "writing" ? WRITING_STEPS : FILING_STEPS} className="text-xs" />
              </div>
            </div>
          )}

          {/* The thread: each ask, and what it did. */}
          {mode === "ready" && turns.length > 0 && (
            <div ref={threadRef} className="thin-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3.5 py-3">
              {turns.map((t) => {
                const isLatest = t.id === latest?.id;
                const r = t.result;
                return (
                  <div key={t.id} className="chat-turn flex flex-col gap-1.5">
                    <div className="ml-auto max-w-[88%] rounded-[12px] rounded-br-[4px] bg-[rgba(221,105,54,0.09)] px-3 py-1.5 text-[12.5px] leading-relaxed text-ink">
                      {t.quote && (
                        <span className="mb-1 block truncate border-l-2 border-accent/50 pl-2 text-[11.5px] italic text-ink-2/80">
                          {t.quote}
                        </span>
                      )}
                      {t.ask.length > 160 ? `${t.ask.slice(0, 157)}…` : t.ask}
                    </div>
                    <div className="flex max-w-[92%] items-start gap-2">
                      <Spark size={12} className={`mt-1 shrink-0 text-accent ${!r ? "ai-spark" : ""}`} />
                      <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
                        {!r ? (
                          <div className="pt-0.5">
                            <div className="ai-bar" />
                            <p className="mt-2 text-xs text-ink-2">{liveNote || "Thinking…"}</p>
                            {editingDoc && (
                              <span className="mt-1 flex items-center gap-1.5 text-[11px] text-accent">
                                <span className="dot-pulse h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                                Writing into your ticket…
                              </span>
                            )}
                          </div>
                        ) : r.kind === "edit" ? (
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex min-w-0 items-center gap-1.5 text-ink-2">
                              {isLatest && undone ? (
                                <span className="text-muted">Reverted</span>
                              ) : (
                                <>
                                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#2e7d32" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
                                    <path d="M5 12l5 5L20 6" />
                                  </svg>
                                  <span className="truncate">{r.summary}</span>
                                </>
                              )}
                            </span>
                            {isLatest && (
                              <button
                                type="button"
                                onClick={() => undoRedo(undone ? r.after : r.before, !undone)}
                                disabled={undoBusy}
                                className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
                              >
                                {undone ? "Redo" : "Undo"}
                              </button>
                            )}
                          </div>
                        ) : r.kind === "answer" ? (
                          <p className="text-ink-2">{r.text}</p>
                        ) : r.kind === "none" ? (
                          <p className="text-muted">{r.text}</p>
                        ) : r.kind === "stopped" ? (
                          <p className="text-muted">Stopped. The ticket is as it was.</p>
                        ) : (
                          <p className="text-[#c62828]">That didn&apos;t go through - try again.</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Suggestions that fit the ticket, or follow-ups after a change. */}
          {showChips && (
            <div className={`flex flex-wrap gap-1.5 px-3 py-2.5 ${turns.length ? "border-t border-hairline" : ""} bg-surface-2/50`}>
              {chips.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => void send(s.prompt)}
                  className="rounded-md border border-hairline bg-surface px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-accent/30 hover:bg-accent/[0.06] hover:text-accent"
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Composer: a quoted passage (from the selection) rides above it. */}
          <div className="shrink-0 border-t border-hairline">
            {quote && (
              <div className="mx-3.5 mt-2.5 flex items-start gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5">
                <span className="line-clamp-2 flex-1 border-l-2 border-accent/50 pl-2 text-[11.5px] italic text-ink-2">{quote}</span>
                <button type="button" onClick={() => setQuote(null)} aria-label="Remove passage" className="text-muted hover:text-ink">
                  ×
                </button>
              </div>
            )}
            <div className="flex items-end gap-2.5 px-3.5 py-3">
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
                      : quote
                        ? "What should change in this passage?"
                        : doc && !doc.body.trim()
                          ? "Ask AI to write the ticket…"
                          : "Ask AI to edit the ticket…"
                }
                className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent py-0.5 text-[13px] leading-relaxed text-ink outline-none placeholder:text-muted disabled:opacity-70"
              />
              {busy ? (
                <button
                  type="button"
                  onClick={stop}
                  aria-label="Stop"
                  title="Stop (Esc)"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink text-white transition hover:brightness-110"
                >
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-white" aria-hidden />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void send(input)}
                  disabled={composerDisabled || !input.trim()}
                  aria-label="Send"
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition ${
                    input.trim() && !composerDisabled ? "bg-accent text-white hover:brightness-95" : "bg-surface-2 text-muted/50"
                  }`}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
