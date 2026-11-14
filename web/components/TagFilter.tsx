"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MAX_TAG_NAME, TAG_COLORS, TAG_COLOR_KEYS, UNTAGGED, type Tag, type TagColor } from "@/lib/tags";

const hrefOf = (tag: string | null) => (tag ? `/tickets?tag=${tag}` : "/tickets");

function TagIcon({ color }: { color?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M2.4 3.6c0-.7.5-1.2 1.2-1.2h3.9c.3 0 .6.1.8.3l5 5c.5.5.5 1.2 0 1.7l-3.9 3.9c-.5.5-1.2.5-1.7 0l-5-5a1.2 1.2 0 0 1-.3-.8V3.6Z"
        fill={color ? `${color}2e` : "none"}
        stroke={color ?? "currentColor"}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="5.4" cy="5.4" r="1" fill={color ?? "currentColor"} />
    </svg>
  );
}

const Check = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-ink">
    <path d="M3.5 8.3 6.5 11.3 12.5 4.8" />
  </svg>
);

/**
 * The tag filter of the Tickets list: one control at the end of the status
 * tabs. Closed, it shows the open tag (or "Tags"). Open, it lists everything,
 * each tag and what has no tag, with their counts; each line is a link, so a
 * tag has its own URL. Tags are made, renamed, recoloured and deleted here
 * too. Closes on Escape or a click outside.
 */
export default function TagFilter({
  tags,
  total,
  untagged,
  active,
  onCreate,
  onRename,
  onRecolor,
  onDelete,
}: {
  tags: Tag[];
  total: number;
  untagged: number;
  /** The open tag: a tag id, "none", or null for everything. */
  active: string | null;
  /** Each answers with what went wrong, or null when it worked. */
  onCreate: (name: string) => Promise<string | null>;
  onRename: (id: string, name: string) => Promise<string | null>;
  onRecolor: (id: string, color: TagColor) => void;
  onDelete: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setOpen(false);
    setEditing(null);
    setAdding(false);
    setName("");
    setError(null);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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

  const current = active && active !== UNTAGGED ? tags.find((t) => t.id === active) : undefined;
  const label = current ? current.name : active === UNTAGGED ? "No tag" : "Tags";
  const edited = editing ? tags.find((t) => t.id === editing) : undefined;

  const line = (key: string | null, text: string, count: number, lead: ReactNode, edit?: Tag) => {
    const on = active === key;
    return (
      <li key={key ?? "all"} className="group/t relative">
        <Link
          href={hrefOf(key)}
          scroll={false}
          onClick={close}
          aria-current={on ? "page" : undefined}
          className={`flex h-8 items-center gap-2 rounded-md pl-2 pr-2 text-[13px] no-underline transition-colors hover:bg-surface-2 ${on ? "font-medium text-ink" : "text-ink-2"}`}
        >
          <span className="flex w-4 shrink-0 justify-center">{lead}</span>
          <span className="min-w-0 flex-1 truncate">{text}</span>
          {on && <Check />}
          <span className={`min-w-[1.25rem] text-right text-xs tabular-nums text-muted ${edit ? "group-hover/t:invisible group-focus-within/t:invisible" : ""}`}>{count}</span>
        </Link>
        {edit && (
          <button
            type="button"
            onClick={() => {
              setEditing(edit.id);
              setAdding(false);
            }}
            title="Edit tag"
            aria-label={`Edit ${edit.name}`}
            className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted opacity-0 hover:bg-[rgba(26,22,18,0.07)] hover:text-ink focus-visible:opacity-100 group-hover/t:opacity-100"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
              <circle cx="3.5" cy="8" r="1.2" />
              <circle cx="8" cy="8" r="1.2" />
              <circle cx="12.5" cy="8" r="1.2" />
            </svg>
          </button>
        )}
      </li>
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={active ? `Tag: ${label}` : "Tags"}
        className={`inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-[7px] pl-2 pr-1.5 text-[13px] transition-colors duration-150 ${
          active || open ? "bg-[var(--color-pressed)] font-medium text-ink" : "text-muted hover:bg-hover hover:text-ink"
        }`}
      >
        <TagIcon color={current ? TAG_COLORS[current.color] : undefined} />
        <span className="truncate">{label}</span>
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M4 6.2 8 10.2 12 6.2" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Tags"
          className="menu absolute right-0 top-full z-40 mt-1.5 w-[256px] p-1"
        >
          {edited ? (
            <TagEditor
              tag={edited}
              onBack={() => setEditing(null)}
              onRename={onRename}
              onRecolor={onRecolor}
              onDelete={(id) => {
                onDelete(id);
                setEditing(null);
              }}
            />
          ) : (
            <>
              <ul className="max-h-[320px] overflow-y-auto">
                {line(
                  null,
                  "All tickets",
                  total,
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true" className="text-muted">
                    <path d="M3 4h10M3 8h10M3 12h6" />
                  </svg>,
                )}
                {tags.map((t) => line(t.id, t.name, t.count, <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TAG_COLORS[t.color] }} />, t))}
                {tags.length > 0 &&
                  line(
                    UNTAGGED,
                    "No tag",
                    untagged,
                    <span className="h-2.5 w-2.5 rounded-full border border-dashed border-muted" />,
                  )}
              </ul>
              <div className="mt-1 border-t border-hairline pt-1">
                {adding ? (
                  <form
                    className="p-1"
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
                          e.stopPropagation();
                          setAdding(false);
                          setName("");
                          setError(null);
                        }
                      }}
                      placeholder="Tag name"
                      aria-label="Tag name"
                      aria-invalid={!!error}
                      className="h-8 w-full rounded-md border border-hairline bg-surface px-2 text-[13px] text-ink outline-none placeholder:text-muted focus:border-accent"
                    />
                    {error && <p className="mt-1 pl-0.5 text-xs text-[#c62828]">{error}</p>}
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(true);
                      setError(null);
                    }}
                    className="flex h-8 w-full items-center gap-2 rounded-md pl-2 pr-2 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    <span className="flex w-4 shrink-0 justify-center">
                      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                        <path d="M8 3v10M3 8h10" />
                      </svg>
                    </span>
                    New tag
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Rename, recolour or delete one tag, in place of the list. */
function TagEditor({
  tag,
  onBack,
  onRename,
  onRecolor,
  onDelete,
}: {
  tag: Tag;
  onBack: () => void;
  onRename: (id: string, name: string) => Promise<string | null>;
  onRecolor: (id: string, color: TagColor) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState(tag.name);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const save = async () => {
    const value = name.trim();
    if (!value || value === tag.name) return onBack();
    const problem = await onRename(tag.id, value);
    if (problem) setError(problem);
    else onBack();
  };

  return (
    <div className="p-1.5">
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
          className="h-8 w-full rounded-md border border-hairline bg-surface px-2 text-[13px] text-ink outline-none focus:border-accent"
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
      <div className="mt-2.5 flex items-center justify-between border-t border-hairline pt-1.5">
        {confirming ? (
          <>
            <span className="pl-1 text-[13px] text-ink-2">Delete this tag?</span>
            <span className="flex gap-1">
              <button type="button" onClick={() => setConfirming(false)} className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-ink">
                Keep
              </button>
              <button type="button" onClick={() => onDelete(tag.id)} className="rounded-md px-2 py-1 text-[13px] font-medium text-[#c62828] hover:bg-[rgba(198,40,40,0.08)]">
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
