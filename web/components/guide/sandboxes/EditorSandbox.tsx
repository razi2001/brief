"use client";

import { useRef, useState } from "react";
import { DEMO_PARAGRAPHS } from "./sample-ticket";
import "../mock/guide.css";

type Bubble = { x: number; y: number } | null;

const btn = "rounded-[6px] px-2 py-1 text-[12.5px] text-cream/90 transition-colors hover:bg-cream/15";

/**
 * A ticket body to edit. Select text: H, B, I and Code really format it;
 * Improve and Shorten swap the paragraph for a pre-written version (a demo,
 * no AI call). Undo puts the last change back.
 */
export default function EditorSandbox({ onUsed }: { onUsed?: () => void }) {
  const body = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [bubble, setBubble] = useState<Bubble>(null);
  const [history, setHistory] = useState<string[]>([]);
  const used = useRef(false);

  const touched = () => {
    if (!used.current) {
      used.current = true;
      onUsed?.();
    }
  };

  const selectionInBody = () => {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !body.current) return null;
    const range = sel.getRangeAt(0);
    return body.current.contains(range.commonAncestorContainer) ? range : null;
  };

  const place = () => {
    const range = selectionInBody();
    if (!range) return setBubble(null);
    const r = range.getBoundingClientRect?.() ?? { left: 0, right: 0, top: 0 };
    const o = box.current?.getBoundingClientRect();
    setBubble({ x: (r.left + r.right) / 2 - (o?.left ?? 0), y: r.top - (o?.top ?? 0) });
  };

  // read the body now: the state updater runs later, after the change
  const snapshot = () => {
    const html = body.current?.innerHTML ?? "";
    setHistory((h) => [...h.slice(-19), html]);
  };

  const format = (cmd: "bold" | "italic" | "heading" | "code") => {
    const range = selectionInBody();
    if (!range) return;
    snapshot();
    if (cmd === "code") {
      const code = document.createElement("code");
      code.className = "rounded-[4px] border hairline bg-[rgba(26,22,18,.05)] px-1 font-mono text-[0.9em]";
      try {
        range.surroundContents(code);
      } catch {
        code.textContent = range.toString();
        range.deleteContents();
        range.insertNode(code);
      }
    } else {
      document.execCommand?.("styleWithCSS", false, "false");
      if (cmd === "heading") document.execCommand?.("formatBlock", false, "h3");
      else document.execCommand?.(cmd);
    }
    touched();
    place();
  };

  const rewrite = (kind: "improve" | "shorten") => {
    const range = selectionInBody();
    const node = range?.startContainer;
    const el = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("[data-p]");
    if (!el) return;
    const p = DEMO_PARAGRAPHS[Number(el.dataset.p)];
    if (!p) return;
    snapshot();
    el.textContent = p[kind];
    el.classList.remove("gd-flashing");
    void el.offsetWidth;
    el.classList.add("gd-flashing");
    window.getSelection()?.removeAllRanges();
    setBubble(null);
    touched();
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (last === undefined || !body.current) return;
    body.current.innerHTML = last;
    setHistory((h) => h.slice(0, -1));
  };

  return (
    <div ref={box} className="relative">
      <div className="rounded-[12px] border hairline bg-white/90 px-5 py-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Summary</span>
          <span className="flex items-center gap-2">
            <span className="rounded-full bg-[rgba(26,22,18,.05)] px-2 py-0.5 text-[11px] text-muted">Demo</span>
            <button type="button" className="btn !px-2 !py-0.5 !text-xs" disabled={!history.length} onClick={undo}>
              Undo
            </button>
          </span>
        </div>
        <div
          ref={body}
          data-testid="editor"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onMouseUp={place}
          onKeyUp={place}
          onInput={touched}
          onBlur={() => setTimeout(() => !selectionInBody() && setBubble(null), 150)}
          className="space-y-2.5 text-[14px] leading-[1.7] text-ink-2 outline-none [&_h3]:text-[16px] [&_h3]:font-semibold [&_h3]:text-ink"
        >
          {DEMO_PARAGRAPHS.map((p, i) => (
            <p key={i} data-p={i}>
              {p.text}
            </p>
          ))}
        </div>
      </div>
      {bubble && (
        <div className="absolute z-10 -translate-x-1/2 -translate-y-full pb-2" style={{ left: bubble.x, top: bubble.y }}>
          <div
            role="toolbar"
            aria-label="Format"
            className="flex items-center gap-0.5 rounded-[9px] border border-[rgba(245,241,232,0.14)] bg-ink p-1 shadow-[0_8px_28px_rgba(26,22,18,0.35)]"
            onMouseDown={(e) => e.preventDefault()}
          >
            <button type="button" className={`${btn} font-bold`} onClick={() => format("heading")}>H</button>
            <span className="mx-0.5 h-4 w-px bg-cream/20" />
            <button type="button" className={`${btn} font-bold`} onClick={() => format("bold")}>B</button>
            <button type="button" className={`${btn} italic`} onClick={() => format("italic")}>I</button>
            <button type="button" className={`${btn} font-mono`} onClick={() => format("code")}>{"</>"}</button>
            <span className="mx-0.5 h-4 w-px bg-cream/20" />
            <button type="button" className={`${btn} inline-flex items-center gap-1`} onClick={() => rewrite("improve")}>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" className="text-accent" aria-hidden="true">
                <path d="M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9z" />
              </svg>
              Improve
            </button>
            <button type="button" className={btn} onClick={() => rewrite("shorten")}>Shorten</button>
          </div>
        </div>
      )}
    </div>
  );
}
