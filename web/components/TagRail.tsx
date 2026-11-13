"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { BRIEF_DRAG_TYPE, MAX_TAG_NAME, TAG_COLORS, TAG_COLOR_KEYS, UNTAGGED, type Tag, type TagColor } from "@/lib/tags";

const hrefOf = (tag: string | null) => (tag ? `/tickets?tag=${tag}` : "/tickets");

function FolderIcon({ color, open = false }: { color?: string; open?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" className="shrink-0">
      <path
        d="M1.8 4.3c0-.7.5-1.2 1.2-1.2h3l1.4 1.5H13c.7 0 1.2.5 1.2 1.2v6c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2V4.3Z"
        fill={color ? (open ? color : `${color}33`) : "none"}
        stroke={color ?? "currentColor"}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The folders beside the Tickets list: everything, one per tag, and what has
 * no tag. A folder is a link, so each has its own URL, and a drop target: drag
 * ticket rows onto it to tag them. On a narrow screen it lies flat above the
 * list and scrolls sideways.
 */
export default function TagRail({
  tags,
  total,
  untagged,
  active,
  onCreate,
  onRename,
  onRecolor,
  onDelete,
  onDropBriefs,
}: {
  tags: Tag[];
  total: number;
  untagged: number;
  /** The open folder: a tag id, "none", or null for everything. */
  active: string | null;
  /** Each answers with what went wrong, or null when it worked. */
  onCreate: (name: string) => Promise<string | null>;
  onRename: (id: string, name: string) => Promise<string | null>;
  onRecolor: (id: string, color: TagColor) => void;
  onDelete: (id: string) => void;
  onDropBriefs: (tagId: string, briefIds: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const submit = async () => {
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    const problem = await onCreate(value);
    setBusy(false);
    setError(problem);
    if (!problem) {
      setName("");
      setAdding(false);
    }
  };

  const dropProps = (tagId: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(BRIEF_DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setOver(tagId);
    },
    onDragLeave: () => setOver((o) => (o === tagId ? null : o)),
    onDrop: (e: DragEvent) => {
      setOver(null);
      const raw = e.dataTransfer.getData(BRIEF_DRAG_TYPE);
      if (!raw) return;
      e.preventDefault();
      try {
        const ids = JSON.parse(raw) as unknown;
        if (Array.isArray(ids)) onDropBriefs(tagId, ids.filter((x): x is string => typeof x === "string"));
      } catch {
        /* not ours */
      }
    },
  });

  const row = (key: string | null, label: string, count: number, lead: ReactNode, extra?: ReactNode, drop?: object) => {
    const on = active === key;
    return (
      <li key={key ?? "all"} className="group/f relative shrink-0" {...drop}>
        <Link
          href={hrefOf(key)}
          scroll={false}
          aria-current={on ? "page" : undefined}
          className={`flex items-center gap-2 rounded-[9px] py-1.5 pl-2 pr-2 text-[13.5px] no-underline transition-colors ${
            on
              ? "bg-white/85 font-medium text-ink shadow-[0_0_0_1px_rgba(26,22,18,.07)]"
              : "text-ink-2/85 hover:bg-white/50 hover:text-ink"
          } ${key && over === key ? "bg-accent/10 shadow-[0_0_0_1.5px_var(--color-accent)]" : ""}`}
        >
          {lead}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className={`text-xs tabular-nums text-muted ${extra ? "min-[1400px]:group-hover/f:invisible min-[1400px]:group-focus-within/f:invisible" : ""}`}>
            {count}
          </span>
        </Link>
        {extra}
      </li>
    );
  };

  return (
    <nav aria-label="Tags" className="min-w-0 min-[1400px]:w-[188px] min-[1400px]:shrink-0">
      <div className="flex items-center justify-between pb-1.5 pl-2 pr-1 max-[1399px]:hidden">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Tags</span>
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            setError(null);
          }}
          title="New tag"
          aria-label="New tag"
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/60 hover:text-ink"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      </div>
      <ul className="no-scrollbar flex gap-1 overflow-x-auto min-[1400px]:flex-col min-[1400px]:gap-0.5 min-[1400px]:overflow-visible">
        {row(
          null,
          "All tickets",
          total,
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-muted">
            <path d="M3 4h10M3 8h10M3 12h6" />
          </svg>,
        )}
        {tags.map((t) =>
          row(
            t.id,
            t.name,
            t.count,
            <FolderIcon color={TAG_COLORS[t.color]} open={active === t.id} />,
            <>
              <button
                type="button"
                onClick={() => setMenuFor((m) => (m === t.id ? null : t.id))}
                title="Edit tag"
                aria-label={`Edit ${t.name}`}
                aria-expanded={menuFor === t.id}
                className={`absolute right-1 top-1/2 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-[rgba(26,22,18,0.07)] hover:text-ink min-[1400px]:flex ${
                  menuFor === t.id ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover/f:opacity-100"
                }`}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
                  <circle cx="3.5" cy="8" r="1.2" />
                  <circle cx="8" cy="8" r="1.2" />
                  <circle cx="12.5" cy="8" r="1.2" />
                </svg>
              </button>
              {menuFor === t.id && (
                <TagMenu
                  tag={t}
                  onClose={() => setMenuFor(null)}
                  onRename={onRename}
                  onRecolor={onRecolor}
                  onDelete={onDelete}
                />
              )}
            </>,
            dropProps(t.id),
          ),
        )}
        {tags.length > 0 &&
          row(
            UNTAGGED,
            "No tag",
            untagged,
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 2" aria-hidden="true" className="shrink-0 text-muted">
              <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.6" />
            </svg>,
          )}
        <li className="shrink-0 min-[1400px]:hidden">
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setError(null);
            }}
            className="flex items-center gap-1.5 rounded-[9px] px-2 py-1.5 text-[13.5px] text-muted hover:bg-white/50 hover:text-ink"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M8 3v10M3 8h10" />
            </svg>
            New tag
          </button>
        </li>
      </ul>
      {adding && (
        <form
          className="mt-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            autoFocus
            value={name}
            maxLength={MAX_TAG_NAME}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setAdding(false);
                setName("");
                setError(null);
              }
            }}
            onBlur={() => {
              if (!name.trim()) setAdding(false);
            }}
            placeholder="Tag name"
            aria-label="Tag name"
            aria-invalid={!!error}
            className="w-full rounded-[9px] border border-hairline bg-surface px-2.5 py-1.5 text-[13.5px] text-ink outline-none placeholder:text-muted focus:border-accent min-[1400px]:w-full max-[1399px]:max-w-[240px]"
          />
          {error && <p className="mt-1 pl-1 text-xs text-[#c62828]">{error}</p>}
        </form>
      )}
    </nav>
  );
}

/** Rename, recolour or delete one tag. Closes on Escape or a click outside. */
function TagMenu({
  tag,
  onClose,
  onRename,
  onRecolor,
  onDelete,
}: {
  tag: Tag;
  onClose: () => void;
  onRename: (id: string, name: string) => Promise<string | null>;
  onRecolor: (id: string, color: TagColor) => void;
  onDelete: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(tag.name);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const save = async () => {
    const value = name.trim();
    if (!value || value === tag.name) return onClose();
    const problem = await onRename(tag.id, value);
    if (problem) setError(problem);
    else onClose();
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Edit ${tag.name}`}
      className="absolute left-2 top-full z-30 mt-1 w-[212px] rounded-xl border border-hairline bg-surface p-2.5 shadow-[0_12px_36px_-12px_rgba(26,22,18,0.28)]"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input
          autoFocus
          value={name}
          maxLength={MAX_TAG_NAME}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          aria-label="Tag name"
          aria-invalid={!!error}
          className="w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[13.5px] text-ink outline-none focus:border-accent"
        />
      </form>
      {error && <p className="mt-1 text-xs text-[#c62828]">{error}</p>}
      <div className="mt-2.5 flex items-center gap-1.5" role="radiogroup" aria-label="Colour">
        {TAG_COLOR_KEYS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={tag.color === c}
            aria-label={c}
            title={c}
            onClick={() => onRecolor(tag.id, c)}
            className="flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110"
            style={{ boxShadow: tag.color === c ? `0 0 0 2px var(--color-surface), 0 0 0 3.5px ${TAG_COLORS[c]}` : undefined }}
          >
            <span className="h-4 w-4 rounded-full" style={{ backgroundColor: TAG_COLORS[c] }} />
          </button>
        ))}
      </div>
      <div className="mt-2.5 flex items-center justify-between border-t border-hairline pt-2">
        {confirming ? (
          <>
            <span className="text-[13px] text-ink-2">Delete this tag?</span>
            <span className="flex gap-1">
              <button type="button" onClick={() => setConfirming(false)} className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-ink">
                Keep
              </button>
              <button
                type="button"
                onClick={() => {
                  onDelete(tag.id);
                  onClose();
                }}
                className="rounded-md px-2 py-1 text-[13px] font-medium text-[#c62828] hover:bg-[rgba(198,40,40,0.08)]"
              >
                Delete
              </button>
            </span>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setConfirming(true)} className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-[#c62828]">
              Delete
            </button>
            <button type="button" onClick={() => void save()} className="rounded-md px-2 py-1 text-[13px] font-medium text-ink hover:bg-surface-2">
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
