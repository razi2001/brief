"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { TrackerLogo } from "./TrackerLogo";
import type { ProviderKey } from "./provider-labels";

/**
 * The issue tracker, as one card with a dropdown.
 *
 * Brief files into exactly one tracker, so a card per provider made the page
 * read like a choice you have to keep making. The card shows the tracker you
 * have; the dropdown is for the rare switch.
 *
 * Picking from the dropdown only PREVIEWS a tracker - the buttons on the card do
 * the work. A switch disconnects the current tracker and redirects to OAuth, so
 * it must never hang off a single mis-click in a menu.
 *
 * Presentational: no Clerk here. Integrations.tsx owns the connection logic and
 * hands this plain state and callbacks, which is what lets tests render it.
 */

export type TrackerOption = { key: ProviderKey; name: string; caption: string };

type Props = {
  options: TrackerOption[];
  /** The tracker Brief files into, if any. */
  connected: ProviderKey | null;
  /** Trackers Clerk calls connected but won't vend a token for any more. */
  stale: string[];
  /** Trackers with a connect or disconnect in flight. */
  busy: Record<string, boolean>;
  /**
   * What the card opens on. Integrations passes the tracker whose last attempt
   * didn't finish, so its error is on screen after the OAuth round trip.
   * Defaults to the connected tracker.
   */
  initialSelected?: ProviderKey | null;
  /** Start with the dropdown open. */
  defaultOpen?: boolean;
  /** An error, pending-verification or fallback line for a tracker, or null. */
  messageFor: (key: ProviderKey) => ReactNode;
  onConnect: (key: ProviderKey) => void;
  onDisconnect: (key: ProviderKey) => void;
};

function Chevron() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function Check() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12l5 5L20 6" />
    </svg>
  );
}

// The card's actions: Linear-sized buttons (globals.css .btn / .btn-accent).
const PRIMARY = "btn-accent h-7 cursor-pointer whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50";
const QUIET = "btn h-7 cursor-pointer whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50";
const STATUS = "inline-flex items-center gap-1.5 text-xs";

export default function TrackerPicker({
  options,
  connected,
  stale,
  busy,
  initialSelected,
  defaultOpen = false,
  messageFor,
  onConnect,
  onDisconnect,
}: Props) {
  const [selected, setSelected] = useState<ProviderKey | null>(
    initialSelected ?? connected ?? null,
  );
  const [open, setOpen] = useState(defaultOpen);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  // Follow a connection that changes under us: once a tracker is connected it is
  // what the card shows. A disconnect leaves the selection alone, so the card
  // turns into "Connect Linear" rather than going blank.
  const [seenConnected, setSeenConnected] = useState(connected);
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected) setSelected(connected);
  }

  const shown = options.find((o) => o.key === selected) ?? null;
  const anyBusy = Object.values(busy).some(Boolean);

  function openMenu() {
    const i = options.findIndex((o) => o.key === selected);
    setActive(i >= 0 ? i : 0);
    setOpen(true);
  }

  function close(refocus = true) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function choose(key: ProviderKey) {
    setSelected(key);
    close();
  }

  // Focus moves into the list while it is open, so the arrow keys drive it.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function onTriggerKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openMenu();
    }
  }

  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    const last = options.length - 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i >= last ? 0 : i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? last : i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(last);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(options[active].key);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close(false);
    }
  }

  function actions(): ReactNode {
    if (!shown) return null;
    const key = shown.key;
    const isBusy = !!busy[key];

    if (key === connected) {
      if (stale.includes(key)) {
        return (
          <>
            <span className={`${STATUS} text-accent`}>
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              Reconnect needed
            </span>
            <button
              type="button"
              onClick={() => onConnect(key)}
              disabled={isBusy}
              className={PRIMARY}
            >
              {isBusy ? "Reconnecting…" : "Reconnect →"}
            </button>
          </>
        );
      }
      return (
        <>
          <span className={`${STATUS} text-muted`}>
            <span className="h-1.5 w-1.5 rounded-full bg-[#2e7d32]" aria-hidden="true" />
            Connected ✓
          </span>
          <button
            type="button"
            onClick={() => onDisconnect(key)}
            disabled={isBusy}
            className={QUIET}
          >
            {isBusy ? "Disconnecting…" : "Disconnect"}
          </button>
        </>
      );
    }

    if (connected) {
      const current = options.find((o) => o.key === connected)?.name ?? "your current tracker";
      return (
        <>
          <button
            type="button"
            onClick={() => setSelected(connected)}
            disabled={isBusy}
            className={QUIET}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConnect(key)}
            disabled={isBusy}
            title={`Disconnects ${current}`}
            className={PRIMARY}
          >
            {isBusy ? "Switching…" : `Switch to ${shown.name} →`}
          </button>
        </>
      );
    }

    return (
      <button
        type="button"
        onClick={() => onConnect(key)}
        disabled={isBusy}
        className={PRIMARY}
      >
        {isBusy ? "Connecting…" : `Connect ${shown.name} →`}
      </button>
    );
  }

  const message = shown ? messageFor(shown.key) : null;

  return (
    // relative z-10: .card's backdrop-filter makes every card its own stacking
    // context, which traps the menu's z-index inside this one - without lifting
    // the whole card, the next section's card paints over the open dropdown.
    <div ref={rootRef} className="card relative z-10 px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-surface ${
              shown ? "hairline" : "border-dashed border-[rgba(26,22,18,.25)]"
            }`}
          >
            {shown && <TrackerLogo kind={shown.key} size={18} />}
          </span>

          <div className="relative min-w-0">
            <button
              ref={triggerRef}
              type="button"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              disabled={anyBusy}
              onClick={() => (open ? close() : openMenu())}
              onKeyDown={onTriggerKey}
              // relative -left-1, not -mx-1: a negative margin shrinks the box
              // the container sizes itself to, which truncated "Choose a
              // tracker" whenever there was no caption line to widen it.
              className="relative -left-1 inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2 disabled:cursor-default disabled:opacity-60"
            >
              <span className="truncate">{shown ? shown.name : "Choose a tracker"}</span>
              <Chevron />
            </button>
            {shown && <p className="text-[13px] text-muted">{shown.caption}</p>}

            {open && (
              <ul
                ref={listRef}
                id={listId}
                role="listbox"
                tabIndex={-1}
                aria-label="Issue tracker"
                aria-activedescendant={`${listId}-${options[active]?.key}`}
                onKeyDown={onListKey}
                className="absolute left-0 top-full z-20 mt-1.5 w-[220px] rounded-lg border hairline bg-surface p-1 outline-none"
                style={{ boxShadow: "0 1px 2px rgba(26,22,18,.06), 0 12px 32px -8px rgba(26,22,18,.18)" }}
              >
                {options.map((o, i) => (
                  <li
                    key={o.key}
                    id={`${listId}-${o.key}`}
                    role="option"
                    aria-selected={o.key === selected}
                    onClick={() => choose(o.key)}
                    onMouseEnter={() => setActive(i)}
                    className={`flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 transition-colors ${
                      i === active ? "bg-surface-2" : ""
                    }`}
                  >
                    <span className="grid w-4 shrink-0 place-items-center">
                      <TrackerLogo kind={o.key} size={14} />
                    </span>
                    {/* Name only: the card already shows the chosen tracker's
                        caption, and at this width the captions truncated to
                        mush ("Files tickets …"). */}
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                      {o.name}
                    </span>
                    {o.key === connected && (
                      <span className="shrink-0 text-xs text-muted">connected</span>
                    )}
                    <span className="w-3 shrink-0 text-accent">
                      {o.key === selected && <Check />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">{actions()}</div>
      </div>

      {message && <p className="mt-3 border-t hairline pt-2.5 text-xs text-muted">{message}</p>}
    </div>
  );
}
