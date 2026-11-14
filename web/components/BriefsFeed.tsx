"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import AutoRefresh from "./AutoRefresh";
import ArchiveButton from "./ArchiveButton";
import Elapsed from "./Elapsed";
import NewDraftButton from "./NewDraftButton";
import RetryButton from "./RetryButton";
import BriefListRow, { briefFacts } from "./BriefListRow";
import { StatusGlyph } from "./StatusBadge";
import { CHROME_STORE_URL } from "@/lib/chrome-store";
import { explainFilingError } from "@/lib/filing-errors";
import type { DashboardBrief } from "@/lib/brief-types";
import { keylessTrackerName } from "@/lib/ticket-sync";
import { useRouter } from "next/navigation";
import TagFilter from "./TagFilter";
import TagPicker from "./TagPicker";
import { UNTAGGED, applyTagChange, changeDelta, type BriefTags, type Tag, type TagColor } from "@/lib/tags";

const NO_TAGS: Tag[] = [];
const NO_BRIEF_TAGS: BriefTags = {};

const titleTextOf = (b: DashboardBrief): string => b.ticket?.title || b.ticket_title || b.title || "";

/**
 * What still needs you: a draft (written up or being written, never filed)
 * and a ticket that didn't file. Everything else has reached the tracker, or
 * is on its way there.
 */
const needsYou = (b: DashboardBrief): boolean => b.status === "failed" || b.status === "drafted" || (b.status === "processing" && !!b.draft);

const DAY = 86_400_000;
const DAYS = ["Today", "This week", "Earlier"] as const;
const dayOf = (b: DashboardBrief, now: number): (typeof DAYS)[number] => {
  const age = now - new Date(b.created_at || "").getTime();
  return !(age >= DAY) ? "Today" : age < 7 * DAY ? "This week" : "Earlier";
};
const ageOf = (b: DashboardBrief, now: number): string => {
  const m = Math.max(0, Math.round((now - new Date(b.created_at || "").getTime()) / 60000));
  return m < 1 ? "now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

/** What a new account still has to do before its first ticket. */
export type Setup = { hasTracker: boolean; trackerName?: string; extensionPaired: boolean };

/**
 * The Tickets page, which is also the first page of the app. It is laid out
 * by importance, not as one flat list:
 *  - the competition, as one line that opens the ranking (the `top` slot);
 *  - the ticket you just filed, large, with its picture and its live state:
 *    most visits happen right after filing, to see it land;
 *  - what needs you (drafts to finish, tickets that didn't file), as cards
 *    with their one action;
 *  - everything else as compact rows, by day. A row carries a status mark
 *    instead of a status column, so there are no tabs and no table head.
 * Search narrows by title or id ("/" jumps to it); Tags narrows to one tag.
 * With no ticket yet, the three steps to the first one take the page.
 *
 * Archive is the only removal (it behaves like a delete: archived briefs are
 * never refetched), on a card, on a row's hover, or for a selection from the
 * floating bar. All are optimistic, with a reliable write behind them.
 */
export default function BriefsFeed({
  briefs,
  isProcessing,
  renderId,
  tags: initialTags = NO_TAGS,
  briefTags: initialBriefTags = NO_BRIEF_TAGS,
  activeTag = null,
  total = 0,
  untagged: initialUntagged = 0,
  draftsOnly: initialDraftsOnly = false,
  top,
  latestImage = null,
  setup = null,
}: {
  briefs: DashboardBrief[];
  isProcessing: boolean;
  /** This server render's id (see AutoRefresh). */
  renderId?: string;
  /** The person's tags, a filter beside the search. */
  tags?: Tag[];
  /** Which tags each listed brief carries. */
  briefTags?: BriefTags;
  /** The open tag: a tag id, "none" for untagged, null for everything. */
  activeTag?: string | null;
  /** Every ticket the person has, and how many carry no tag. */
  total?: number;
  untagged?: number;
  /** Open on what needs you only: links that used to go to the Drafts page. */
  draftsOnly?: boolean;
  /** Over the title: the competition line. */
  top?: ReactNode;
  /** A picture of the newest ticket (its first screenshot), when it has one. */
  latestImage?: string | null;
  /** Shown as the three first steps while there is no ticket yet. */
  setup?: Setup | null;
}) {
  const router = useRouter();

  // ── Tags ───────────────────────────────────────────────────────────────
  // The server's lists, changed here first so a tag lands the moment you drop
  // it. Each new server render replaces them: the server has the last word.
  const [tagSrc, setTagSrc] = useState(initialTags);
  const [tags, setTags] = useState(initialTags);
  const [untagged, setUntagged] = useState(initialUntagged);
  const [briefTagSrc, setBriefTagSrc] = useState(initialBriefTags);
  const [briefTags, setBriefTags] = useState(initialBriefTags);
  if (tagSrc !== initialTags) {
    setTagSrc(initialTags);
    setTags(initialTags);
    setUntagged(initialUntagged);
  }
  if (briefTagSrc !== initialBriefTags) {
    setBriefTagSrc(initialBriefTags);
    setBriefTags(initialBriefTags);
  }

  const send = async (url: string, method: string, body?: unknown): Promise<Response | null> => {
    try {
      const res = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      // A signed-out call is redirected to the sign-in page, which answers 200.
      return res.redirected ? null : res;
    } catch {
      return null;
    }
  };
  const problemOf = (res: Response | null): string | null => {
    if (res?.ok) return null;
    if (res?.status === 409) return "You already have this tag";
    if (res?.status === 429) return "That's the most tags you can keep";
    return "Couldn't save. Try again";
  };

  const byName = (a: Tag, b: Tag) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

  const createTagRaw = async (name: string): Promise<{ tag?: Tag; problem?: string }> => {
    const res = await send("/api/tags", "POST", { name });
    const problem = problemOf(res);
    if (problem || !res) return { problem: problem ?? "Couldn't save. Try again" };
    const { tag } = (await res.json()) as { tag: Tag };
    setTags((ts) => [...ts, tag].sort(byName));
    return { tag };
  };
  const createTag = async (name: string) => (await createTagRaw(name)).problem ?? null;

  const renameTag = async (id: string, name: string) => {
    const problem = problemOf(await send(`/api/tags/${id}`, "PATCH", { name }));
    if (!problem) setTags((ts) => ts.map((t) => (t.id === id ? { ...t, name } : t)).sort(byName));
    return problem;
  };
  const recolorTag = (id: string, color: TagColor) => {
    setTags((ts) => ts.map((t) => (t.id === id ? { ...t, color } : t)));
    void send(`/api/tags/${id}`, "PATCH", { color }).then((res) => {
      if (!res?.ok) router.refresh();
    });
  };
  const deleteTag = (id: string) => {
    setTags((ts) => ts.filter((t) => t.id !== id));
    setBriefTags((bt) => Object.fromEntries(Object.entries(bt).map(([k, v]) => [k, v.filter((t) => t !== id)])));
    void send(`/api/tags/${id}`, "DELETE").then(() => {
      // Its tickets may now have no tag at all: let the server recount.
      if (activeTag === id) router.push("/tickets");
      else router.refresh();
    });
  };

  /** Put a tag on (or take it off) these briefs: here at once, then saved. */
  const setTagOn = (tagId: string, ids: string[], on: boolean) => {
    const delta = changeDelta(briefTags, ids, tagId, on);
    if (delta === 0) return;
    const next = applyTagChange(briefTags, ids, tagId, on);
    const bare = (bt: BriefTags) => ids.filter((id) => !(bt[id] ?? []).length).length;
    setUntagged((u) => Math.max(0, u + bare(next) - bare(briefTags)));
    setTags((ts) => ts.map((t) => (t.id === tagId ? { ...t, count: Math.max(0, t.count + delta) } : t)));
    setBriefTags(next);
    void send(`/api/tags/${tagId}/briefs`, "POST", { briefIds: ids, on }).then((res) => {
      // It didn't save: show what the server really has.
      if (!res?.ok) router.refresh();
    });
  };
  const createAndTag = async (name: string, ids: string[]) => {
    const { tag, problem } = await createTagRaw(name);
    if (tag) setTagOn(tag.id, ids, true);
    return problem ?? null;
  };

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const tagsOf = (id: string): Tag[] => (briefTags[id] ?? []).map((t) => tagById.get(t)).filter((t): t is Tag => !!t);
  // The server already narrowed the list to the open tag; this keeps it
  // true the moment a tag is added or removed here.
  const inFolder = (b: DashboardBrief) =>
    activeTag === null ? true : activeTag === UNTAGGED ? (briefTags[b.id] ?? []).length === 0 : (briefTags[b.id] ?? []).includes(activeTag);

  const [tagMenuOpen, setTagMenuOpen] = useState(false);

  // ── Archive ────────────────────────────────────────────────────────────
  // Optimistic: the row swipes out and is gone (archived briefs aren't
  // fetched). `archivedIds` covers the gap until the next load.
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  // Pending exit-animation timers, so a failed archive can cancel the commit
  // step and bring the row back cleanly.
  const exitTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const addTo = (set: typeof setArchivedIds) => (id: string) => set((prev) => new Set(prev).add(id));
  const dropFrom = (set: typeof setArchivedIds) => (id: string) =>
    set((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  const onArchive = (id: string) => {
    setLeaving((prev) => new Set(prev).add(id));
    const t = setTimeout(() => {
      addTo(setArchivedIds)(id);
      dropFrom(setLeaving)(id);
      exitTimers.current.delete(id);
    }, 340);
    exitTimers.current.set(id, t);
  };

  // The server write failed for good: undo the optimistic removal so the row
  // reappears at once instead of vanishing and coming back on a later load.
  const onArchiveFailed = (id: string) => {
    const t = exitTimers.current.get(id);
    if (t) {
      clearTimeout(t);
      exitTimers.current.delete(id);
    }
    dropFrom(setLeaving)(id);
    dropFrom(setArchivedIds)(id);
  };

  // A capture not sent yet ("uploaded") is still being composed in the
  // extension, and what was archived this session is gone.
  const liveBriefs = useMemo(
    () => briefs.filter((b) => b.status !== "uploaded" && !archivedIds.has(b.id) && inFolder(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inFolder reads only activeTag and briefTags
    [briefs, archivedIds, activeTag, briefTags],
  );

  // ── Search ─────────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [draftsOnly, setDraftsOnly] = useState(initialDraftsOnly);
  const searchRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const visible = liveBriefs.filter(
    (b) =>
      !q ||
      // A keyless ticket shows its tracker's name where the id would be, so that matches too.
      `${titleTextOf(b)} ${b.ticket_identifier || ""} ${keylessTrackerName(b.ticket_identifier, b.provider)}`.toLowerCase().includes(q),
  );
  const todo = visible.filter(needsYou);
  const filed = draftsOnly ? [] : visible.filter((b) => !needsYou(b));
  const shown = [...todo, ...filed];
  // The clock, read once: a render must give the same answer twice.
  const [now] = useState(() => Date.now());
  // The newest ticket stands large while it is fresh (being filed, or from
  // today) and nothing narrows the list: it is the one you came to see.
  const newest = briefs.find((b) => b.status !== "uploaded" && !needsYou(b));
  const latest = !q && activeTag === null && filed[0] && filed[0].id === newest?.id && (filed[0].status === "processing" || dayOf(filed[0], now) === "Today") ? filed[0] : null;
  const rest = latest ? filed.slice(1) : filed;
  const days = DAYS.map((d) => ({ d, items: rest.filter((b) => dayOf(b, now) === d) })).filter((g) => g.items.length > 0);
  const [copied, setCopied] = useState(false);
  const copyLink = async (shareId: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/b/${shareId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };

  // ── Selection ──────────────────────────────────────────────────────────
  // No "select mode": a checkbox shows on row hover, and selecting any row
  // brings up the bar.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anySelected = selected.size > 0;
  const clearSelection = () => {
    setSelected(new Set());
    setTagMenuOpen(false);
  };
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = shown.length > 0 && shown.every((b) => selected.has(b.id));

  // Archive a set of ids: optimistic swipe-out first, then a reliable write
  // (keepalive so it lands even if the page changes).
  const archiveSelected = () => {
    const ids = [...selected];
    ids.forEach((id) => onArchive(id));
    ids.forEach((id) => fetch(`/api/briefs/${id}/archive`, { method: "POST", credentials: "same-origin", keepalive: true }).catch(() => {}));
    clearSelection();
  };

  // "/" jumps to the search; Escape leaves it, then drops the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && el === searchRef.current) {
        setQuery("");
        searchRef.current?.blur();
      } else if (e.key === "Escape" && !typing) {
        setSelected(new Set());
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const hasAny = liveBriefs.length > 0;
  // The tag filter shows once there is anything to tag.
  const showTags = total > 0 || tags.length > 0;

  const row = (b: DashboardBrief) => (
    <BriefListRow
      key={b.id}
      brief={b}
      onArchive={onArchive}
      onArchiveFailed={onArchiveFailed}
      leaving={leaving.has(b.id)}
      selected={selected.has(b.id)}
      anySelected={anySelected}
      onToggleSelect={toggleSelect}
      tags={tagsOf(b.id)}
      onRemoveTag={(tagId) => setTagOn(tagId, [b.id], false)}
    />
  );
  const label = (text: string, count?: number) => (
    <h2 className="section-label">
      {text}
      {count !== undefined && <span className="count">{count}</span>}
    </h2>
  );

  const steps: Array<{ done: boolean; label: string; doneLabel: string; action: string; href: string; external?: boolean }> = setup
    ? [
        { done: setup.hasTracker, label: "Connect your tracker", doneLabel: setup.trackerName ? `${setup.trackerName} connected` : "Tracker connected", action: "Connect", href: "/connections#tracker" },
        { done: setup.extensionPaired, label: "Add the Brief extension to Chrome", doneLabel: "Extension connected", action: "Get it", href: CHROME_STORE_URL, external: true },
        // A page broken on purpose, to file a first ticket from.
        { done: false, label: "File your first ticket", doneLabel: "", action: "Practice", href: "https://get-brief.app/demo-sandbox", external: true },
      ]
    : [];
  const nextStep = steps.findIndex((x) => !x.done);

  const lf = latest ? briefFacts(latest) : null;

  return (
    <section>
      {top && <div>{top}</div>}
      <header className={`flex items-center gap-2 ${top ? "pt-6" : ""}`}>
        <h1 className="page-title mr-auto">Tickets</h1>
        {hasAny && (
          <label className="group/s flex h-[30px] w-[150px] items-center gap-2 rounded-[7px] bg-[var(--color-hover)] px-2.5 text-muted transition-[width,background-color,box-shadow] duration-200 ease-[var(--ease-out)] focus-within:w-[240px] focus-within:bg-surface focus-within:shadow-[0_0_0_1px_var(--color-line),0_0_0_4px_var(--color-accent-soft)] max-sm:hidden">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className="shrink-0">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search tickets"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
            />
            {!query && (
              <kbd aria-hidden className="rounded-[4px] border border-hairline bg-surface px-1 font-sans text-[11px] leading-[1.4] text-faint group-focus-within/s:hidden">
                /
              </kbd>
            )}
          </label>
        )}
        {showTags && (
          <TagFilter
            tags={tags}
            total={total}
            untagged={untagged}
            active={activeTag}
            onCreate={createTag}
            onRename={renameTag}
            onRecolor={recolorTag}
            onDelete={deleteTag}
          />
        )}
        <AutoRefresh active={isProcessing} renderId={renderId} />
        <NewDraftButton />
      </header>

      {!hasAny ? (
        <div className="pb-6 pt-6">
          {steps.length > 0 && activeTag === null && (
            <div className="mb-8">
              {label("Get started", undefined)}
              <ol className="grid gap-3 sm:grid-cols-3">
                {steps.map((x, i) => (
                  <li
                    key={x.label}
                    className={`action-card animate-rise ${x.done ? "!bg-surface" : i === nextStep ? "!border-[rgba(221,105,54,.3)] !bg-[var(--color-accent-soft)]" : ""}`}
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <span className="flex items-center gap-2.5">
                      <span
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs tabular-nums ${
                          x.done ? "bg-[#2e7d32]/12 text-[#2e7d32]" : i === nextStep ? "bg-accent text-white" : "bg-surface text-muted"
                        }`}
                      >
                        {x.done ? (
                          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="m5 12 5 5 9-10" />
                          </svg>
                        ) : (
                          i + 1
                        )}
                      </span>
                      <span className={`text-[13.5px] font-medium ${x.done ? "text-muted" : "text-ink"}`}>{x.done ? x.doneLabel : x.label}</span>
                    </span>
                    {!x.done &&
                      (x.external ? (
                        <a href={x.href} target="_blank" rel="noreferrer" className={`self-end ${i === nextStep ? "btn-accent" : "btn"} h-7 !px-2.5 !py-0`}>
                          {x.action}
                        </a>
                      ) : (
                        <Link href={x.href} className={`self-end ${i === nextStep ? "btn-accent" : "btn"} h-7 !px-2.5 !py-0`}>
                          {x.action}
                        </Link>
                      ))}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="animate-rise flex flex-col items-center rounded-[14px] border border-dashed border-[var(--color-line)] px-4 py-12 text-center">
            <p className="text-[14px] font-medium text-ink">{activeTag !== null ? "No tickets here" : "No tickets yet"}</p>
          </div>
        </div>
      ) : shown.length === 0 ? (
        // Narrowed down to nothing: the way back is right here.
        <div className="animate-rise flex flex-col items-center gap-3 px-4 py-20 text-center">
          <p className="text-[14px] font-medium text-ink">{q ? "Nothing matches" : "Nothing needs you"}</p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setDraftsOnly(false);
            }}
            className="btn h-[30px]"
          >
            {q ? "Clear search" : "All tickets"}
          </button>
        </div>
      ) : (
        <div className="pb-6 pt-6">
          {/* The one you just filed. */}
          {latest && lf && !archivedIds.has(latest.id) && (
            <article
              className={`animate-rise group relative flex items-stretch gap-5 overflow-hidden rounded-[16px] border border-hairline bg-surface p-3 transition-[box-shadow,border-color] duration-200 hover:border-[var(--color-line)] hover:shadow-[0_10px_28px_-16px_rgba(26,22,18,.3)]${leaving.has(latest.id) ? " brief-leaving" : ""}`}
            >
              {lf.href &&
                (lf.hrefExternal ? (
                  <a href={lf.href} target="_blank" rel="noreferrer" aria-label={`${lf.title}, open in ${lf.providerName}`} className="absolute inset-0" />
                ) : (
                  <Link href={lf.href} aria-label={lf.title} className="absolute inset-0" />
                ))}
              {latestImage && (
                <span className="block h-[132px] w-[212px] shrink-0 overflow-hidden rounded-[10px] border border-hairline bg-cream max-sm:hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={latestImage} alt="" className="h-full w-full object-cover object-top" />
                </span>
              )}
              <div className="flex min-w-0 flex-1 flex-col py-1.5 pr-2">
                <p className="flex items-center gap-2 text-[13px] text-muted">
                  <StatusGlyph kind={lf.mark.kind} color={lf.mark.color} />
                  <span className={lf.isProcessing ? "font-medium tabular-nums text-accent" : "font-medium text-ink-2"}>
                    {lf.isProcessing ? (
                      <>
                        {lf.writing ? "Writing" : `Filing to ${lf.providerName}`} <Elapsed since={latest.updated_at || latest.created_at} />
                      </>
                    ) : (
                      lf.mark.name
                    )}
                  </span>
                  {latest.ticket_identifier && !lf.isProcessing && (
                    <>
                      <span className="text-faint">·</span>
                      <span className="font-mono text-xs">{latest.ticket?.identifier || latest.ticket_identifier}</span>
                    </>
                  )}
                  <span className="text-faint">·</span>
                  <span className="tabular-nums">{ageOf(latest, now)}</span>
                </p>
                <h2 className="mt-2 line-clamp-2 text-[19px] font-semibold leading-snug tracking-[-0.015em] text-ink">{lf.title}</h2>
                <p className="relative z-10 mt-auto flex items-center gap-1 pt-3">
                  {lf.href &&
                    (lf.hrefExternal ? (
                      <a href={lf.href} target="_blank" rel="noreferrer" className="btn mr-1 h-[30px]">
                        Open in {lf.providerName}
                      </a>
                    ) : (
                      <Link href={lf.href} className="btn mr-1 h-[30px]">
                        Open
                      </Link>
                    ))}
                  {latest.share_id && (
                    <button type="button" onClick={() => void copyLink(latest.share_id!)} className="btn-ghost h-[30px] px-2.5">
                      {copied ? "Copied" : "Copy link"}
                    </button>
                  )}
                  <ArchiveButton briefId={latest.id} onArchive={onArchive} onArchiveFailed={onArchiveFailed} label="Archive" />
                </p>
              </div>
              {lf.isProcessing && <span aria-hidden className="queue-bar" />}
            </article>
          )}

          {/* What needs you: each one a card with its one action. */}
          {todo.length > 0 && (
            <div className={latest ? "mt-8" : ""}>
              {label("Needs you", todo.length)}
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {todo.map((b, i) => {
                  const f = briefFacts(b);
                  return (
                    <li
                      key={b.id}
                      className={`action-card animate-rise${f.isFailed ? " !border-[rgba(209,67,67,.25)] !bg-[rgba(209,67,67,.04)]" : ""}${leaving.has(b.id) ? " brief-leaving" : ""}`}
                      style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                    >
                      <span className="flex items-start gap-2">
                        <span className="mt-[3px]">
                          <StatusGlyph kind={f.mark.kind} color={f.mark.color} />
                        </span>
                        <span className="min-w-0">
                          {f.briefHref ? (
                            <Link href={f.briefHref} className="line-clamp-2 text-[13.5px] font-medium leading-snug text-ink no-underline hover:underline">
                              {f.title}
                            </Link>
                          ) : (
                            <span className="line-clamp-2 text-[13.5px] font-medium leading-snug text-ink">{f.title}</span>
                          )}
                          {f.isFailed && b.error && (
                            <span className="mt-1 line-clamp-2 block text-xs text-[#b3402f]" title={explainFilingError(b.error)}>
                              {explainFilingError(b.error)}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs tabular-nums text-muted">
                          {f.isProcessing ? "Writing" : f.mark.name} · {ageOf(b, now)}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <ArchiveButton briefId={b.id} onArchive={onArchive} onArchiveFailed={onArchiveFailed} label="Archive" />
                          {f.isFailed ? (
                            <RetryButton briefId={b.id} />
                          ) : (
                            f.briefHref && (
                              <Link href={f.briefHref} className="btn h-7 !px-2.5 !py-0">
                                {f.isProcessing ? "Open" : "Finish"}
                              </Link>
                            )
                          )}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Everything else: compact, by day. */}
          {days.map(({ d, items }, gi) => (
            <div key={d} className={gi > 0 || latest || todo.length > 0 ? "mt-8" : ""}>
              {label(d)}
              <ul className="-mx-2.5 sm:-mx-9">{items.map(row)}</ul>
            </div>
          ))}
          {draftsOnly && (
            <p className="mt-6">
              <button type="button" onClick={() => setDraftsOnly(false)} className="text-[13px] text-muted transition-colors hover:text-ink">
                All tickets
              </button>
            </p>
          )}

          {/* Floating bar for a selection: slides up from the bottom. Sticky
              (not fixed), so it floats over a long list and rests below a
              short one; the wrapper is click-through, the pill isn't. */}
          {anySelected && (
            <div className="pointer-events-none sticky bottom-4 z-20 mt-3 flex justify-center">
              <div className="animate-bar-rise pointer-events-auto flex items-center gap-1 rounded-[10px] border border-white/10 bg-ink px-1.5 py-1 text-cream shadow-[0_1px_2px_rgba(26,22,18,.2),0_12px_32px_-8px_rgba(26,22,18,.35)]">
                <span className="px-2 text-[13px] tabular-nums text-cream/90">{selected.size} selected</span>
                {!allSelected && (
                  <button
                    type="button"
                    onClick={() => setSelected(new Set(shown.map((b) => b.id)))}
                    className="rounded-md px-2 py-1.5 text-[13px] text-cream/70 transition-colors hover:bg-cream/10 hover:text-cream"
                  >
                    Select all
                  </button>
                )}
                <span className="mx-0.5 h-4 w-px bg-cream/20" />
                <span className="relative">
                  <button
                    type="button"
                    onClick={() => setTagMenuOpen((o) => !o)}
                    aria-expanded={tagMenuOpen}
                    title="Tag selected"
                    className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-cream/90 transition-colors hover:bg-cream/10 hover:text-cream"
                  >
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M2.5 8.2V3.5a1 1 0 0 1 1-1h4.7l5.6 5.6a1 1 0 0 1 0 1.4l-4.3 4.3a1 1 0 0 1-1.4 0L2.5 8.2Z" />
                      <circle cx="5.6" cy="5.6" r="0.9" />
                    </svg>
                    Tag
                  </button>
                  {tagMenuOpen && (
                    <TagPicker
                      tags={tags}
                      briefTags={briefTags}
                      briefIds={[...selected]}
                      onToggle={(tagId, on) => setTagOn(tagId, [...selected], on)}
                      onCreate={(name) => createAndTag(name, [...selected])}
                      onClose={() => setTagMenuOpen(false)}
                    />
                  )}
                </span>
                <button
                  type="button"
                  onClick={archiveSelected}
                  title="Archive selected"
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-cream/90 transition-colors hover:bg-cream/10 hover:text-cream"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="4" rx="1" />
                    <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
                  </svg>
                  Archive
                </button>
                <span className="mx-0.5 h-4 w-px bg-cream/20" />
                <button
                  type="button"
                  onClick={clearSelection}
                  title="Clear selection"
                  aria-label="Clear selection"
                  className="inline-flex items-center justify-center rounded-md p-1.5 text-cream/70 transition-colors hover:bg-cream/10 hover:text-cream"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
