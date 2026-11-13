"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_TAG_NAME, TAG_COLORS, allTagged, type BriefTags, type Tag } from "@/lib/tags";

/**
 * The Tag menu of the bulk bar: every tag with a tick when all the selected
 * tickets carry it. A click puts it on them all, or takes it off them all.
 * Typing a new name makes that tag and puts it on. Opens upward, since the bar
 * sits at the bottom of the list. Closes on Escape or a click outside.
 */
export default function TagPicker({
  tags,
  briefTags,
  briefIds,
  onToggle,
  onCreate,
  onClose,
}: {
  tags: Tag[];
  briefTags: BriefTags;
  briefIds: string[];
  onToggle: (tagId: string, on: boolean) => void;
  /** Answers with what went wrong, or null when it worked. */
  onCreate: (name: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // The Tag button is this menu's parent's sibling: let its own click toggle.
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
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

  const submit = async () => {
    const value = name.trim();
    if (!value || busy) return;
    // A name you already have: just put that tag on.
    const same = tags.find((t) => t.name.toLowerCase() === value.toLowerCase());
    if (same) {
      onToggle(same.id, true);
      setName("");
      return;
    }
    setBusy(true);
    const problem = await onCreate(value);
    setBusy(false);
    setError(problem);
    if (!problem) setName("");
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Tags"
      className="absolute bottom-full left-0 z-30 mb-2 w-[232px] rounded-xl border border-hairline bg-surface p-1.5 text-ink shadow-[0_12px_36px_-12px_rgba(26,22,18,0.32)]"
    >
      {tags.length > 0 && (
        <ul className="max-h-[220px] overflow-y-auto">
          {tags.map((t) => {
            const on = allTagged(briefTags, briefIds, t.id);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  onClick={() => onToggle(t.id, !on)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px] hover:bg-surface-2"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: TAG_COLORS[t.color] }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {on && (
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent" aria-hidden="true">
                      <path d="M5 12l5 5L20 6" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className={tags.length > 0 ? "mt-1 border-t border-hairline pt-1.5" : undefined}
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
          placeholder="New tag"
          aria-label="New tag"
          aria-invalid={!!error}
          className="w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[13.5px] text-ink outline-none placeholder:text-muted focus:border-accent"
        />
        {error && <p className="mt-1 px-1 text-xs text-[#c62828]">{error}</p>}
      </form>
    </div>
  );
}
