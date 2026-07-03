"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import ExportButtons from "./ExportButtons";
import { TrackerLogo } from "./TrackerLogo";
import ProgressCycler from "./ProgressCycler";
import { CURSOR_SENTINEL } from "@/lib/chat-stream";
import { mdToHtml, htmlToMarkdown } from "@/lib/md-html";

// Illustrative progress steps while the draft is filed to a tracker. Not a live
// trace - a natural, moving status so the wait reads as work being done.
const FILING_STEPS = [
  "Connecting to your tracker…",
  "Checking the workspace…",
  "Finding the right team…",
  "Choosing the right labels…",
  "Setting the priority…",
  "Creating the ticket…",
];

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
    innerRef,
    onInput,
    onBlur,
    onKeyDown,
  }: {
    html: string;
    editable: boolean;
    innerRef: React.RefObject<HTMLDivElement | null>;
    onInput?: () => void;
    onBlur?: () => void;
    onKeyDown?: (e: React.KeyboardEvent) => void;
  }) {
    return (
      <div
        ref={innerRef}
        contentEditable={editable}
        suppressContentEditableWarning
        onInput={onInput}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className="ticket-prose mt-6 outline-none"
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

const PILL =
  "inline-flex items-center gap-1.5 rounded-full border border-hairline bg-cream/50 px-3 py-1.5 text-xs text-ink-2 no-underline transition-colors hover:bg-cream-2/70 hover:text-ink disabled:opacity-60";

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
  hasLinear,
  hasJira,
  filing = false,
}: {
  briefId: string;
  shareId: string;
  isOwner: boolean;
  isDraft: boolean;
  ticketUrl: string | null;
  provider: "linear" | "jira";
  providerName: string;
  initialTitle: string;
  initialBody: string;
  assets: AssetMeta[];
  hasLinear: boolean;
  hasJira: boolean;
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
      // Keep the assistant's typing position in view, gently.
      body.querySelector(".writing-caret")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
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

    window.addEventListener("brief:doc:get", onGet);
    window.addEventListener("brief:doc:stream", onStream);
    window.addEventListener("brief:doc:done", onDone);
    window.addEventListener("brief:doc:cancel", onCancel);
    return () => {
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

  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 900);
  }
  function flushSave() {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    void save();
  }
  async function save() {
    const title = (titleRef.current?.innerText || "").trim() || "Untitled";
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

  return (
    <div>
      {/* Action toolbar - primary (export/open) + share + copy + save status */}
      <div className="mb-7 flex flex-wrap items-center gap-2">
        {/* Primary action: file the draft, or jump to the filed ticket. */}
        {isOwner && isDraft && <ExportButtons briefId={briefId} linear={hasLinear} jira={hasJira} />}
        {!isDraft && ticketUrl && (
          <a className={PILL} href={ticketUrl} target="_blank" rel="noreferrer">
            <TrackerLogo kind={provider} size={13} />
            Open in {providerName}
            <span className="text-muted">{ICON.external}</span>
          </a>
        )}
        {/* The public shareable link - sits right next to the primary action. */}
        <button
          type="button"
          className={PILL}
          title="Shareable link — anyone with it can view this brief"
          onClick={() => copy("link", `${window.location.origin}/b/${shareId}`)}
        >
          {copied === "link" ? ICON.check : ICON.share}
          {copied === "link" ? "Link copied" : "Share link"}
        </button>
        <button type="button" className={PILL} onClick={() => copy("md", currentMarkdown())}>
          {copied === "md" ? ICON.check : ICON.md}
          {copied === "md" ? "Copied" : "Copy Markdown"}
        </button>
        {filing && <ProgressCycler messages={FILING_STEPS} className="text-xs" />}
        {aiEditing && (
          <span className="inline-flex items-center gap-1.5 text-xs text-accent">
            <span className="dot-pulse h-2 w-2 rounded-full bg-accent" aria-hidden />
            Assistant is editing…
          </span>
        )}
        {canEdit && !aiEditing && status !== "idle" && (
          <span className={`ml-0.5 text-xs ${status === "error" ? "text-[#c62828]" : "text-muted"}`}>
            {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Couldn't save"}
          </span>
        )}
      </div>

      {/* Title (editable in place for the owner) */}
      <h1
        ref={titleRef}
        contentEditable={canEdit}
        suppressContentEditableWarning
        onInput={canEdit ? scheduleSave : undefined}
        onBlur={canEdit ? flushSave : undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); bodyRef.current?.focus(); }
        }}
        className="font-display text-3xl leading-[1.08] text-ink outline-none sm:text-[2.7rem]"
      >
        {initialTitle}
      </h1>

      {/* Body - server-rendered (no flash); editable in place for the owner.
          Frozen after mount (see EditableBody) so edits are never wiped. */}
      <EditableBody
        html={initialHtml}
        editable={canEdit}
        innerRef={bodyRef}
        onInput={canEdit ? scheduleSave : undefined}
        onBlur={canEdit ? flushSave : undefined}
        onKeyDown={canEdit ? onBodyKeyDown : undefined}
      />

      {/* Floating selection toolbar (owner) */}
      {canEdit && !aiEditing && bubble && (
        <div className="fixed z-50 -translate-x-1/2" style={{ top: bubble.y, left: bubble.left }}>
          <div className="flex items-center gap-0.5 rounded-lg border border-[rgba(245,241,232,0.14)] bg-ink p-1 shadow-[0_8px_28px_rgba(26,22,18,0.35)]">
            <button type="button" title="Heading" className={`${bubbleBtn} text-[0.8125rem] font-bold`} onMouseDown={noMouseSteal} onClick={() => format("heading")}>H</button>
            <span className="mx-0.5 h-4 w-px self-center bg-cream/20" aria-hidden />
            <button type="button" title="Bold (⌘B)" className={`${bubbleBtn} font-bold`} onMouseDown={noMouseSteal} onClick={() => format("bold")}>B</button>
            <button type="button" title="Italic (⌘I)" className={`${bubbleBtn} italic`} onMouseDown={noMouseSteal} onClick={() => format("italic")}>I</button>
            <button type="button" title="Code (⌘E)" className={bubbleBtn} onMouseDown={noMouseSteal} onClick={() => format("code")}>{ICON.code}</button>
          </div>
        </div>
      )}
    </div>
  );
}
