"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import ExportButtons from "./ExportButtons";
import { TrackerLogo } from "./TrackerLogo";
import ProgressCycler, { FILING_STEPS } from "./ProgressCycler";
import { CURSOR_SENTINEL } from "@/lib/chat-stream";
import { mdToHtml, htmlToMarkdown } from "@/lib/md-html";
import type { ProviderKey } from "./provider-labels";

/**
 * The editable body. Server-rendered (no flash) and then NEVER re-rendered - the
 * contentEditable DOM is the browser's after mount, so re-applying the HTML on a
 * parent re-render (e.g. the auto-save status flipping) would wipe live edits.
 * That was the "saving, then resets to old version" bug. The always-equal
 * comparator freezes it after mount; handlers read refs so staleness is harmless.
 */
const EditableBody = memo(
  function EditableBody({
    html,
    editable,
    placeholder,
    innerRef,
    onInput,
    onBlur,
    onKeyDown,
  }: {
    html: string;
    editable: boolean;
    placeholder?: string;
    innerRef: React.RefObject<HTMLDivElement | null>;
    onInput?: (e: React.FormEvent<HTMLElement>) => void;
    onBlur?: () => void;
    onKeyDown?: (e: React.KeyboardEvent) => void;
  }) {
    return (
      <div
        ref={innerRef}
        contentEditable={editable}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={onInput}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className="ticket-prose mt-7 outline-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  },
  () => true,
);

const SVG = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const ICON = {
  link: SVG(<><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></>),
  share: SVG(<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></>),
  md: SVG(<><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M7 15V9l2.5 3L12 9v6M16 9v4m0 0 1.6-1.6M16 13l-1.6-1.6" /></>),
  check: SVG(<path d="M5 12l5 5L20 6" />),
  code: SVG(<><path d="m8 8-4 4 4 4" /><path d="m16 8 4 4-4 4" /></>),
  external: SVG(<><path d="M7 17 17 7" /><path d="M8 7h9v9" /></>),
};

// Secondary actions: quiet ghost buttons so they never compete with the accent
// primary (Export / Connect). Borderless at rest, subtle bg on hover.
const BTN_GHOST =
  "inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-muted no-underline transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-60";

type AssetMeta = { filename: string; kind: "image" | "video" };

function evidenceMarkdown(assets: AssetMeta[]): string {
  if (!assets.length) return "";
  let md = "\n\n## Evidence\n";
  let img = 0;
  let vid = 0;
  for (const a of assets) {
    if (a.kind === "image") md += `\n![Screenshot ${++img}](${a.filename})`;
    else md += `\n[Recording ${++vid}](${a.filename})`;
  }
  return md;
}

export default function TicketDoc({
  briefId,
  shareId,
  isOwner,
  isDraft,
  ticketUrl,
  provider,
  providerName,
  initialTitle,
  initialBody,
  assets,
  connected,
  exportError = null,
  filing = false,
}: {
  briefId: string;
  shareId: string;
  isOwner: boolean;
  isDraft: boolean;
  ticketUrl: string | null;
  provider: ProviderKey;
  providerName: string;
  initialTitle: string;
  initialBody: string;
  assets: AssetMeta[];
  /** Trackers the owner has connected, offered as export targets on a draft. */
  connected: ProviderKey[];
  /** Why the last export of this draft failed, shown beside the export buttons. */
  exportError?: string | null;
  /** Being filed to a tracker right now: read-only + a "Filing…" indicator, but
   *  the full header/toolbar stays (no stripped-down page). */
  filing?: boolean;
}) {
  // Editing is allowed only for the owner, and only while it's still a draft.
  // Once filed, the page is a live read-only mirror of the tracker ticket (the
  // owner edits it in Linear/Jira), so local edits can't drift from the source.
  const canEdit = isOwner && isDraft && !filing;
  const initialHtml = useMemo(() => mdToHtml(initialBody), [initialBody]);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const savedTitle = useRef(initialTitle);
  const savedHtml = useRef(initialHtml);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [copied, setCopied] = useState<"" | "link" | "md">("");
  // Floating selection toolbar position (viewport coords), or null when hidden.
  const [bubble, setBubble] = useState<{ y: number; left: number } | null>(null);
  // The chat assistant is streaming a rewrite into the doc (editing locked).
  const [aiEditing, setAiEditing] = useState(false);
  const preEdit = useRef<{ titleText: string; html: string } | null>(null);

  // The body is server-rendered via dangerouslySetInnerHTML (so it paints
  // immediately - no flash of empty content), and React never re-applies it
  // because `initialHtml` is stable, so live edits are preserved. We only read
  // the rendered DOM once to set the save baseline.
  useEffect(() => {
    if (bodyRef.current) savedHtml.current = bodyRef.current.innerHTML;
  }, []);

  // A blank draft opens ready to type its title.
  useEffect(() => {
    if (canEdit && !initialTitle.trim() && !initialBody.trim()) titleRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  // ── Chat assistant bridge ──────────────────────────────────────────────
  // TicketChat is a separate client island (the sidebar), so it coordinates
  // with the editor over window events: it asks for the current doc, streams
  // the model's rewrite in live (caret trailing), then finalizes with a soft
  // "settled" flash on the blocks that changed. A failed stream restores the
  // pre-edit snapshot so a half-rewrite is never left behind.
  useEffect(() => {
    if (!canEdit) return;

    const lock = () => {
      if (preEdit.current) return;
      preEdit.current = {
        titleText: titleRef.current?.innerText ?? "",
        html: bodyRef.current?.innerHTML ?? "",
      };
      setAiEditing(true);
      if (bodyRef.current) bodyRef.current.contentEditable = "false";
      if (titleRef.current) titleRef.current.contentEditable = "false";
    };
    const unlock = () => {
      preEdit.current = null;
      setAiEditing(false);
      if (bodyRef.current) bodyRef.current.contentEditable = "true";
      if (titleRef.current) titleRef.current.contentEditable = "true";
    };

    const onGet = (e: Event) => {
      const d = (e as CustomEvent).detail as { reply?: (doc: { title: string; body: string }) => void };
      d?.reply?.({
        title: (titleRef.current?.innerText || "").trim(),
        body: bodyRef.current ? htmlToMarkdown(bodyRef.current) : "",
      });
    };

    const onStream = (e: Event) => {
      // Targeted edits carry a CURSOR_SENTINEL where the assistant is typing -
      // the caret renders mid-document, riding the insertion point. A full
      // rewrite (caret:true) streams top-to-bottom with the caret at the end.
      const d = (e as CustomEvent).detail as { title: string | null; body: string; caret?: boolean };
      const body = bodyRef.current;
      if (!body) return;
      lock();
      if (d.title && titleRef.current && titleRef.current.innerText !== d.title) {
        titleRef.current.innerText = d.title;
      }
      let html = mdToHtml(d.body);
      if (html.includes(CURSOR_SENTINEL)) {
        html = html.replace(CURSOR_SENTINEL, '<span class="writing-caret"></span>');
      } else if (d.caret !== false) {
        html += '<span class="writing-caret"></span>';
      }
      body.innerHTML = html;
      // Keep the assistant's typing position in view, gently. Guarded: a throw
      // here (e.g. a runtime without scrollIntoView) would abort the edit mid-
      // stream and cancel the whole thing.
      const caret = body.querySelector(".writing-caret");
      if (caret && typeof caret.scrollIntoView === "function") {
        caret.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    };

    const onDone = (e: Event) => {
      const d = (e as CustomEvent).detail as { title: string | null; body: string };
      const body = bodyRef.current;
      if (!body || !preEdit.current) return;

      // Old top-level blocks, so we can flash only what actually changed.
      const tmp = document.createElement("div");
      tmp.innerHTML = preEdit.current.html;
      const oldBlocks = new Set(Array.from(tmp.children).map((el) => el.outerHTML));
      const titleChanged = !!d.title && d.title !== preEdit.current.titleText.trim();

      if (d.title && titleRef.current) titleRef.current.innerText = d.title;
      body.innerHTML = mdToHtml(d.body.split(CURSOR_SENTINEL).join(""));
      Array.from(body.children).forEach((el) => {
        if (!oldBlocks.has(el.outerHTML)) el.classList.add("blk-new");
      });
      if (titleChanged) titleRef.current?.classList.add("blk-new");

      // The route persisted the revision; align the save baseline so autosave
      // doesn't re-post, and show the honest "Saved" tick.
      if (d.title) savedTitle.current = d.title;
      savedHtml.current = body.innerHTML;
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2000);

      unlock();
      // Let the settle animation finish, then drop the marker classes.
      setTimeout(() => {
        body.querySelectorAll(".blk-new").forEach((el) => el.classList.remove("blk-new"));
        titleRef.current?.classList.remove("blk-new");
        savedHtml.current = body.innerHTML;
      }, 3000);
    };

    const onCancel = () => {
      const snap = preEdit.current;
      if (snap && bodyRef.current) {
        bodyRef.current.innerHTML = snap.html;
        if (titleRef.current) titleRef.current.innerText = snap.titleText;
      }
      unlock();
    };

    // Undo / redo from the rail: set the doc to a known snapshot, flash the
    // whole body so the restored content is legible, and align the baseline
    // (the rail persists it via /edit, so autosave must not double-post).
    const onSet = (e: Event) => {
      const d = (e as CustomEvent).detail as { title: string | null; body: string };
      const body = bodyRef.current;
      if (!body) return;
      if (d.title && titleRef.current) titleRef.current.innerText = d.title;
      body.innerHTML = mdToHtml(d.body);
      body.classList.add("blk-new");
      if (d.title) savedTitle.current = d.title;
      savedHtml.current = body.innerHTML;
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2000);
      setTimeout(() => {
        body.classList.remove("blk-new");
        savedHtml.current = body.innerHTML;
      }, 2600);
    };

    window.addEventListener("brief:doc:get", onGet);
    window.addEventListener("brief:doc:stream", onStream);
    window.addEventListener("brief:doc:done", onDone);
    window.addEventListener("brief:doc:cancel", onCancel);
    window.addEventListener("brief:doc:set", onSet);
    return () => {
      window.removeEventListener("brief:doc:set", onSet);
      window.removeEventListener("brief:doc:get", onGet);
      window.removeEventListener("brief:doc:stream", onStream);
      window.removeEventListener("brief:doc:done", onDone);
      window.removeEventListener("brief:doc:cancel", onCancel);
    };
  }, [canEdit]);

  // Owner: a formatting bubble that follows the text selection (Notion-style).
  useEffect(() => {
    if (!canEdit) return;
    const update = () => {
      const sel = window.getSelection();
      const body = bodyRef.current;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !body) return setBubble(null);
      const range = sel.getRangeAt(0);
      if (!body.contains(range.commonAncestorContainer)) return setBubble(null);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return setBubble(null);
      const y = rect.top > 60 ? rect.top - 46 : rect.bottom + 10;
      setBubble({ y, left: rect.left + rect.width / 2 });
    };
    const hide = () => setBubble(null);
    document.addEventListener("selectionchange", update);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", hide, true);
    };
  }, [canEdit]);

  function currentMarkdown(): string {
    const title = (isOwner && titleRef.current ? titleRef.current.innerText : savedTitle.current).trim() || "Untitled";
    const body = isOwner && bodyRef.current ? htmlToMarkdown(bodyRef.current) : initialBody;
    return `# ${title}\n\n${body}`.trim() + evidenceMarkdown(assets);
  }

  async function copy(kind: "link" | "md", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(""), 1600);
    } catch {
      /* clipboard blocked */
    }
  }

  function format(cmd: "bold" | "italic" | "code" | "heading") {
    bodyRef.current?.focus();
    if (cmd === "code") {
      const sel = window.getSelection();
      const text = sel?.toString() ?? "";
      if (text) {
        const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        document.execCommand("insertHTML", false, `<code>${esc}</code>`);
      }
    } else if (cmd === "heading") {
      const cur = (document.queryCommandValue("formatBlock") || "").toLowerCase();
      document.execCommand("formatBlock", false, /h[1-6]/.test(cur) ? "p" : "h2");
    } else {
      try { document.execCommand("styleWithCSS", false, "false"); } catch {}
      document.execCommand(cmd, false);
    }
    scheduleSave();
  }

  function onBodyKeyDown(e: React.KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === "b") { e.preventDefault(); format("bold"); }
    else if (k === "i") { e.preventDefault(); format("italic"); }
    else if (k === "e") { e.preventDefault(); format("code"); }
  }

  // Erasing everything leaves a stray <br> behind; drop it so the field is
  // :empty again and its placeholder comes back.
  function onFieldInput(e: React.FormEvent<HTMLElement>) {
    const el = e.currentTarget;
    if (!el.textContent?.trim() && el.innerHTML) el.innerHTML = "";
    scheduleSave();
  }

  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 900);
  }
  function flushSave() {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    void save();
  }
  async function save() {
    // Empty stays empty (the heading shows its placeholder), so leaving a
    // blank title doesn't save the word "Untitled" into it.
    const title = (titleRef.current?.innerText || "").trim();
    const html = bodyRef.current?.innerHTML ?? "";
    if (title === savedTitle.current && html === savedHtml.current) return;
    const body = bodyRef.current ? htmlToMarkdown(bodyRef.current) : "";
    setStatus("saving");
    try {
      const res = await fetch(`/api/briefs/${briefId}/edit`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      if (!res.ok) return setStatus("error");
      savedTitle.current = title;
      savedHtml.current = html;
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2000);
    } catch {
      setStatus("error");
    }
  }

  const bubbleBtn = "flex h-7 w-7 items-center justify-center rounded-md text-cream/80 transition-colors hover:bg-cream/15 hover:text-cream";
  const noMouseSteal = (e: React.MouseEvent) => e.preventDefault();
  const aiBtn = "flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-cream/85 transition-colors hover:bg-cream/15 hover:text-cream";
  // Hand the selected passage to the assistant: run `prompt` on just that
  // text, or (no prompt) quote it in the composer to say what to do.
  function askAI(prompt?: string) {
    const quote = window.getSelection()?.toString().trim();
    if (!quote) return;
    window.dispatchEvent(new CustomEvent("brief:ai:ask", { detail: { prompt, quote } }));
    window.getSelection()?.removeAllRanges();
    setBubble(null);
  }

  return (
    <div>
      {/* Title (editable in place for the owner) */}
      <h1
        ref={titleRef}
        contentEditable={canEdit}
        suppressContentEditableWarning
        data-placeholder="Untitled"
        onInput={canEdit ? onFieldInput : undefined}
        onBlur={canEdit ? flushSave : undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); bodyRef.current?.focus(); }
        }}
        className="text-[28px] font-semibold leading-[1.2] tracking-[-0.022em] text-ink outline-none sm:text-[32px]"
      >
        {initialTitle}
      </h1>

      {/* Action toolbar - one primary, then quiet ghost secondaries. */}
      <div className="mt-5 flex flex-wrap items-center gap-1 border-b border-hairline pb-5">
        {/* Primary: export the draft, or open the filed ticket. */}
        {isOwner && isDraft && <ExportButtons briefId={briefId} connected={connected} initialError={exportError ?? ""} />}
        {!isDraft && ticketUrl && (
          <a
            className="btn"
            href={ticketUrl}
            target="_blank"
            rel="noreferrer"
          >
            <TrackerLogo kind={provider} size={13} />
            Open in {providerName}
            <span className="text-muted">{ICON.external}</span>
          </a>
        )}

        {/* Thin divider between the primary and the quiet secondaries. */}
        {((isOwner && isDraft) || (!isDraft && ticketUrl)) && (
          <span className="mx-1.5 h-4 w-px bg-[rgba(26,22,18,0.12)] max-sm:hidden" aria-hidden />
        )}

        <button
          type="button"
          className={BTN_GHOST}
          title="Copy share link"
          onClick={() => copy("link", `${window.location.origin}/b/${shareId}`)}
        >
          {copied === "link" ? ICON.check : ICON.share}
          {copied === "link" ? "Link copied" : "Share"}
        </button>
        <button type="button" className={BTN_GHOST} title="Copy as Markdown" onClick={() => copy("md", currentMarkdown())}>
          {copied === "md" ? ICON.check : ICON.md}
          {copied === "md" ? "Copied" : "Markdown"}
        </button>

        {/* Owner's filing status lives in the assistant rail; visitors (no
            rail) get the moving status here in the toolbar. */}
        {filing && !isOwner && <ProgressCycler messages={FILING_STEPS} className="ml-1.5 text-[13px]" />}
        {aiEditing && (
          <span className="ml-1.5 inline-flex items-center gap-1.5 text-[13px] text-accent">
            <span className="dot-pulse h-2 w-2 rounded-full bg-accent" aria-hidden />
            Assistant is editing…
          </span>
        )}
        {canEdit && !aiEditing && status !== "idle" && (
          <span className={`ml-auto text-xs ${status === "error" ? "text-[#c62828]" : "text-muted"}`}>
            {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Couldn't save"}
          </span>
        )}
      </div>


      {/* Body - server-rendered (no flash); editable in place for the owner.
          Frozen after mount (see EditableBody) so edits are never wiped. */}
      <EditableBody
        html={initialHtml}
        editable={canEdit}
        placeholder={canEdit ? "Add description…" : undefined}
        innerRef={bodyRef}
        onInput={canEdit ? onFieldInput : undefined}
        onBlur={canEdit ? flushSave : undefined}
        onKeyDown={canEdit ? onBodyKeyDown : undefined}
      />

      {/* Floating selection toolbar (owner) */}
      {canEdit && !aiEditing && bubble && (
        <div className="fixed z-50 -translate-x-1/2" style={{ top: bubble.y, left: bubble.left }}>
          <div className="flex items-center gap-0.5 rounded-[9px] border border-[rgba(245,241,232,0.14)] bg-ink p-1 shadow-[0_8px_28px_rgba(26,22,18,0.35)]">
            <button type="button" title="Heading" className={`${bubbleBtn} text-[0.8125rem] font-bold`} onMouseDown={noMouseSteal} onClick={() => format("heading")}>H</button>
            <span className="mx-0.5 h-4 w-px self-center bg-cream/20" aria-hidden />
            <button type="button" title="Bold (⌘B)" className={`${bubbleBtn} font-bold`} onMouseDown={noMouseSteal} onClick={() => format("bold")}>B</button>
            <button type="button" title="Italic (⌘I)" className={`${bubbleBtn} italic`} onMouseDown={noMouseSteal} onClick={() => format("italic")}>I</button>
            <button type="button" title="Code (⌘E)" className={bubbleBtn} onMouseDown={noMouseSteal} onClick={() => format("code")}>{ICON.code}</button>
            <span className="mx-0.5 h-4 w-px self-center bg-cream/20" aria-hidden />
            <button type="button" className={aiBtn} onMouseDown={noMouseSteal} onClick={() => askAI("Improve this passage: clearer and better written, same meaning.")}>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" className="text-accent" aria-hidden="true"><path d="M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9z" /></svg>
              Improve
            </button>
            <button type="button" className={aiBtn} onMouseDown={noMouseSteal} onClick={() => askAI("Make this passage shorter, keep what matters.")}>Shorten</button>
            <button type="button" className={aiBtn} onMouseDown={noMouseSteal} onClick={() => askAI()}>Ask AI</button>
          </div>
        </div>
      )}
    </div>
  );
}
