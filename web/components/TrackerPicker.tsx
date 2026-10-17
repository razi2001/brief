"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { TrackerLogo } from "./TrackerLogo";
import { NOT_AVAILABLE, WORKSPACE_NOUN, type ProviderKey } from "./provider-labels";

/**
 * The issue tracker, as one card with a dropdown.
 *
 * Brief files into exactly one tracker, so a card per provider made the page
 * read like a choice you have to keep making. The card shows the tracker you
 * have; the dropdown is for the rare switch.
 *
 * Picking from the dropdown only PREVIEWS a tracker - the buttons on the card do
 * the work. A switch replaces the current tracker, so it must never hang off a
 * single mis-click in a menu.
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
  /** Connected, but waiting on a workspace (or organization) pick. */
  needsWorkspace?: ProviderKey[];
  /** Trackers this deployment can't connect yet (no OAuth app for them). */
  unavailable?: ProviderKey[];
  /**
   * Connected through a Clerk account that Brief's own OAuth can take over:
   * the card offers Reconnect beside Disconnect.
   */
  updatable?: ProviderKey[];
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
  /** An error that names no tracker, shown whatever the card is on (or not). */
  notice?: ReactNode;
  onConnect: (key: ProviderKey) => void;
  onDisconnect: (key: ProviderKey) => void;
  /** Move an `updatable` tracker onto Brief's own OAuth, disconnecting nothing. */
  onUpdate?: (key: ProviderKey) => void;
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

// The menu's tallest size (22rem) and its gap from the trigger, in px.
const MENU_MAX = 352;
const MENU_GAP = 6;
// Room kept between the menu and the window's edge.
const EDGE = 12;

/**
 * Where the open menu goes, in viewport coordinates.
 *
 * The menu is portalled to <body> with position: fixed because the Settings
 * list it sits in clips its rows (overflow: hidden, for the rounded corners),
 * and ten trackers no longer fit inside the row. It opens below the trigger,
 * or above it when there is more room there, and never runs off the window.
 */
/**
 * Trackers this deployment can connect first, the ones still "Soon" after,
 * each group in its own (registry) order. A list that opens on a run of
 * greyed-out names reads as broken; the real choices belong on top.
 */
export function availableFirst<T extends { key: ProviderKey }>(items: readonly T[], unavailable: readonly ProviderKey[]): T[] {
  const soon = new Set(unavailable);
  return [...items.filter((i) => !soon.has(i.key)), ...items.filter((i) => soon.has(i.key))];
}

export function menuPlacement(trigger: DOMRect, viewportHeight: number): CSSProperties {
  const below = viewportHeight - trigger.bottom - MENU_GAP - EDGE;
  const above = trigger.top - MENU_GAP - EDGE;
  const left = Math.max(EDGE, trigger.left - 4);
  if (below >= Math.min(MENU_MAX, 240) || below >= above) {
    return { left, top: trigger.bottom + MENU_GAP, maxHeight: Math.min(MENU_MAX, below) };
  }
  return { left, bottom: viewportHeight - trigger.top + MENU_GAP, maxHeight: Math.min(MENU_MAX, above) };
}

// PageUp / PageDown move this many options.
const PAGE = 5;
// Letters typed within this long of each other search as one word.
const TYPE_AHEAD_MS = 500;

/** "Organization needed": what a tracker waiting on its pick is missing. */
function pickNeeded(key: ProviderKey): string {
  const noun = WORKSPACE_NOUN[key] ?? "workspace";
  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} needed`;
}

export default function TrackerPicker({
  options: given,
  connected,
  stale,
  needsWorkspace = [],
  unavailable = [],
  updatable = [],
  busy,
  initialSelected,
  defaultOpen = false,
  messageFor,
  notice,
  onConnect,
  onDisconnect,
  onUpdate,
}: Props) {
  // Every index below (active option, keyboard moves, type-ahead) is into this
  // ordered list, so the menu and the keys always agree.
  const options = availableFirst(given, unavailable);
  const [selected, setSelected] = useState<ProviderKey | null>(
    initialSelected ?? connected ?? null,
  );
  const [open, setOpen] = useState(defaultOpen);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();
  const [place, setPlace] = useState<CSSProperties | null>(null);
  // Reconnect and Disconnect share the tracker's busy flag; this says which of
  // the two is in flight, so only that one reads as working.
  const [updating, setUpdating] = useState<ProviderKey | null>(null);

  // Keep the portalled menu pinned to its trigger while the page scrolls or
  // the window resizes. Measured before paint, so it never flashes at 0,0.
  useLayoutEffect(() => {
    if (!open) return;
    function measure() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPlace(menuPlacement(rect, window.innerHeight));
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

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

  // Ten trackers can outgrow a short window, so the list scrolls.
  function scrollToOption(i: number) {
    const key = options[i]?.key;
    if (key) document.getElementById(`${listId}-${key}`)?.scrollIntoView?.({ block: "nearest" });
  }

  // Focus moves into the list while it is open, so the arrow keys drive it,
  // and the chosen tracker is scrolled into view. Only on opening: hovering
  // moves the active option too, and must not scroll the list.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    list?.focus();
    list?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [open]);

  /** A keyboard move: the option comes into view. Hover only highlights. */
  function moveTo(i: number) {
    setActive(i);
    scrollToOption(i);
  }

  /**
   * Type-ahead: jump to the next tracker whose name starts with what was just
   * typed. Repeating one letter cycles through the trackers that start with it.
   */
  function typeAhead(ch: string, now: number) {
    const prev = now - typed.current.at < TYPE_AHEAD_MS ? typed.current.text : "";
    const text = `${prev}${ch}`.toLowerCase();
    typed.current = { text, at: now };
    const cycling = [...text].every((c) => c === text[0]);
    const query = cycling ? text[0] : text;
    const from = cycling ? active + 1 : active;
    for (let n = 0; n < options.length; n++) {
      const i = (from + n) % options.length;
      if (options[i].name.toLowerCase().startsWith(query)) {
        moveTo(i);
        return;
      }
    }
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      // The menu lives in <body>, outside the card, so both count as inside.
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
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
    // A space inside a typed word ("Azure DevOps") searches; on its own it picks.
    const typing = e.timeStamp - typed.current.at < TYPE_AHEAD_MS && typed.current.text !== "";
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveTo(active >= last ? 0 : active + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveTo(active <= 0 ? last : active - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      moveTo(last);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      moveTo(Math.min(last, active + PAGE));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      moveTo(Math.max(0, active - PAGE));
    } else if (e.key === " " && typing) {
      e.preventDefault();
      typeAhead(" ", e.timeStamp);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(options[active].key);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      typeAhead(e.key, e.timeStamp);
    }
  }

  function actions(): ReactNode {
    if (!shown) return null;
    const key = shown.key;
    const isBusy = !!busy[key];
    const isUnavailable = unavailable.includes(key);

    const notYet = isUnavailable && <span className={`${STATUS} text-muted`}>{NOT_AVAILABLE}</span>;

    if (key === connected) {
      if (stale.includes(key)) {
        return (
          <>
            <span className={`${STATUS} text-accent`}>
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              Reconnect needed
            </span>
            {notYet}
            <button
              type="button"
              onClick={() => onConnect(key)}
              disabled={isBusy || isUnavailable}
              className={PRIMARY}
            >
              {isBusy ? "Reconnecting…" : "Reconnect →"}
            </button>
          </>
        );
      }
      if (needsWorkspace.includes(key)) {
        return (
          <>
            <span className={`${STATUS} text-accent`}>
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              {pickNeeded(key)}
            </span>
            <button
              type="button"
              onClick={() => onDisconnect(key)}
              disabled={isBusy}
              className={QUIET}
            >
              {isBusy ? "Disconnecting…" : "Disconnect"}
            </button>
            {/* The Team row holds the picker; SettingsList opens a row from its #id. */}
            <a href="#team" className={`${PRIMARY} no-underline`}>
              Pick
            </a>
          </>
        );
      }
      const isUpdating = isBusy && updating === key;
      return (
        <>
          <span className={`${STATUS} text-muted`}>
            <span className="h-1.5 w-1.5 rounded-full bg-[#2e7d32]" aria-hidden="true" />
            Connected ✓
          </span>
          <button
            type="button"
            onClick={() => {
              setUpdating(null);
              onDisconnect(key);
            }}
            disabled={isBusy}
            className={QUIET}
          >
            {isBusy && !isUpdating ? "Disconnecting…" : "Disconnect"}
          </button>
          {onUpdate && updatable.includes(key) && (
            <button
              type="button"
              onClick={() => {
                setUpdating(key);
                onUpdate(key);
              }}
              disabled={isBusy}
              className={QUIET}
            >
              {isUpdating ? "Reconnecting…" : "Reconnect"}
            </button>
          )}
        </>
      );
    }

    if (connected) {
      const current = options.find((o) => o.key === connected)?.name ?? "your current tracker";
      return (
        <>
          {notYet}
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
            disabled={isBusy || isUnavailable}
            title={`Replaces ${current}`}
            className={PRIMARY}
          >
            {isBusy ? "Switching…" : `Switch to ${shown.name} →`}
          </button>
        </>
      );
    }

    return (
      <>
        {notYet}
        <button
          type="button"
          onClick={() => onConnect(key)}
          disabled={isBusy || isUnavailable}
          className={PRIMARY}
        >
          {isBusy ? "Connecting…" : `Connect ${shown.name} →`}
        </button>
      </>
    );
  }

  const message = (shown && messageFor(shown.key)) || notice || null;

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

            {open && place && createPortal(
              <ul
                ref={listRef}
                id={listId}
                role="listbox"
                tabIndex={-1}
                aria-label="Issue tracker"
                aria-activedescendant={`${listId}-${options[active]?.key}`}
                onKeyDown={onListKey}
                className="fixed z-50 max-h-[22rem] w-[240px] overflow-y-auto overscroll-contain rounded-lg border hairline bg-surface p-1 outline-none"
                style={{ ...place, boxShadow: "0 1px 2px rgba(26,22,18,.06), 0 12px 32px -8px rgba(26,22,18,.18)" }}
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
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{o.name}</span>
                    {/* A short visible tag rather than greyed-out text: dimmed
                        names read as broken, a tag reads as a decision. The
                        full wording is what a screen reader hears. */}
                    {unavailable.includes(o.key) && (
                      <span className="shrink-0 rounded-full border hairline px-1.5 text-[11px] leading-[18px] text-muted">
                        <span aria-hidden="true">Soon</span>
                        <span className="sr-only">{NOT_AVAILABLE}</span>
                      </span>
                    )}
                    {o.key === connected && (
                      <span className="shrink-0 text-xs text-muted">connected</span>
                    )}
                    <span className="w-3 shrink-0 text-accent">
                      {o.key === selected && <Check />}
                    </span>
                  </li>
                ))}
              </ul>,
              document.body,
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">{actions()}</div>
      </div>

      {message && <p className="mt-3 border-t hairline pt-2.5 text-xs text-muted">{message}</p>}
    </div>
  );
}
