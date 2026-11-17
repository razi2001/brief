"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent } from "react";
import Avatar from "./Avatar";
import { MAX_GROUP_TITLE } from "@/lib/bash-review";
import type { BashPerson, BashReview as Review, ReviewGroup, ReviewItem } from "@/lib/bash-server";

/** What a dragged report carries: its brief id. */
const REPORT_DRAG_TYPE = "application/x-bash-report";

type Api = (path: string, method: "POST" | "PATCH", body?: unknown) => Promise<{ ok: boolean; status: number; message?: string }>;

/**
 * The review of a quality competition that held its reports, for whoever started it: every report, in
 * groups of the same bug, each group one ticket to be. Brief groups them; here
 * they are checked (rename a group, move a report by dragging it or from its
 * menu, leave one out) and filed, one group or all at once. A group that is a
 * ticket, or is becoming one, no longer changes.
 *
 * The groups sit side by side, two to a row, so a session's worth of bugs
 * fits on a screen.
 *
 * Every change is sent, then the whole bash is read again (`onChange`), so the
 * panel always shows what the server has.
 */
export default function BashReview({
  code,
  review,
  people,
  onChange,
}: {
  code: string;
  review: Review;
  people: BashPerson[];
  /** Read the bash again. */
  onChange: () => Promise<void>;
}) {
  // Changes are sent one after the other, in the order they were made: a
  // second one made while the first is still saving waits, it is never lost.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [problem, setProblem] = useState<{ text: string; tracker?: boolean } | null>(null);
  const [filingAll, setFilingAll] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [showDropped, setShowDropped] = useState(false);

  const api: Api = async (path, method, body) => {
    try {
      const res = await fetch(`/api/bashes/${code}/review${path}`, {
        method,
        credentials: "same-origin",
        // lands even if the page is left right after (a rename, then a click away)
        keepalive: true,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      // A signed-out call is redirected to the sign-in page, which answers 200.
      if (res.redirected) return { ok: false, status: 401 };
      const data = res.ok ? null : ((await res.json().catch(() => null)) as { error?: string; message?: string } | null);
      return { ok: res.ok, status: res.status, message: data?.message };
    } catch {
      return { ok: false, status: 0 };
    }
  };

  // Group the reports the first time the review opens. Once: the server keeps
  // a claim too, so a second tab changes nothing.
  const asked = useRef(false);
  useEffect(() => {
    if (review.grouped || asked.current) return;
    asked.current = true;
    void api("", "POST").then(async (r) => {
      if (!r.ok) setProblem({ text: "Couldn't group the reports. Reload to try again" });
      await onChange();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mount, by design
  }, [review.grouped]);

  const change = (path: string, body: unknown): Promise<void> => {
    queue.current = queue.current.then(async () => {
      setProblem(null);
      const r = await api(path, "PATCH", body);
      if (!r.ok) setProblem({ text: r.status === 409 ? "That group is already a ticket" : "Couldn't save. Try again" });
      await onChange();
    });
    return queue.current;
  };

  /** Ask for one group's ticket. False when filing should stop (no tracker). */
  const file = async (groupId: string): Promise<boolean> => {
    const r = await api(`/groups/${groupId}/export`, "POST");
    if (r.ok) return true;
    if (r.status === 409 && r.message && /connect|tracker|workspace|expired|reconnect/i.test(r.message)) {
      setProblem({ text: r.message, tracker: true });
      return false;
    }
    setProblem({ text: r.message ?? "Couldn't create the ticket. Try again" });
    return true;
  };

  const fileable = review.groups.filter((g) => !g.ticket && !g.filing && g.reports.some((r) => !r.writing));
  const fileOne = async (groupId: string) => {
    setProblem(null);
    await file(groupId);
    await onChange();
  };
  const fileAll = async () => {
    if (filingAll) return;
    setFilingAll(true);
    setProblem(null);
    for (const g of fileable) {
      if (!(await file(g.id))) break;
      await onChange();
    }
    await onChange();
    setFilingAll(false);
  };

  if (!review.grouped) {
    return (
      <section aria-label="Review" aria-busy="true">
        <h2 className="section-label">Review</h2>
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-[13.5px] text-ink-2">
            <span className="dot-pulse h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            Grouping the reports
          </p>
          {[72, 56, 64].map((w, i) => (
            <div key={i} className="animate-pulse rounded-[14px] border border-hairline p-3.5">
              <div className="h-4 rounded bg-surface-2" style={{ width: `${w}%` }} />
              <div className="mt-3 h-3 w-2/5 rounded bg-surface-2" />
            </div>
          ))}
          {problem && <p className="text-[13px] text-[#c62828]">{problem.text}</p>}
        </div>
      </section>
    );
  }

  const reports = review.groups.reduce((n, g) => n + g.reports.length, 0);
  const filed = review.groups.filter((g) => g.ticket).length;
  const targets = review.groups.filter((g) => !g.ticket && !g.filing);

  const dropOn = (groupId: string, locked: boolean) =>
    locked
      ? {}
      : {
          onDragOver: (e: DragEvent) => {
            if (!e.dataTransfer.types.includes(REPORT_DRAG_TYPE)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setOver(groupId);
          },
          onDragLeave: () => setOver((o) => (o === groupId ? null : o)),
          onDrop: (e: DragEvent) => {
            setOver(null);
            const id = e.dataTransfer.getData(REPORT_DRAG_TYPE);
            if (!id) return;
            e.preventDefault();
            const from = review.groups.find((g) => g.reports.some((r) => r.id === id));
            if (from?.id !== groupId) void change(`/reports/${id}`, { to: groupId });
          },
        };

  return (
    <section aria-label="Review">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-2">
        <h2 className="section-label !pb-0">Review</h2>
        <div className="flex items-center gap-3">
          <span className="text-[13px] tabular-nums text-muted">
            {review.groups.length} {review.groups.length === 1 ? "bug" : "bugs"} from {reports} {reports === 1 ? "report" : "reports"}
            {filed > 0 && ` · ${filed} filed`}
          </span>
          {fileable.length > 0 && (
            <button type="button" onClick={() => void fileAll()} disabled={filingAll} className="btn-accent h-[30px]">
              {filingAll ? "Creating" : fileable.length === 1 ? "Create ticket" : `Create ${fileable.length} tickets`}
            </button>
          )}
        </div>
      </header>

      {problem && (
        <p role="alert" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] bg-[rgba(198,40,40,0.05)] px-3 py-2 text-[13px] text-[#c62828]">
          {problem.text}
          {problem.tracker && (
            <Link href="/connections#tracker" className="font-medium text-ink underline underline-offset-2">
              Open Settings
            </Link>
          )}
        </p>
      )}

      {review.groups.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--color-line)] px-4 py-12 text-center">
          <p className="text-[14px] font-medium text-ink">Nothing to review</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {review.groups.map((g) => {
            const locked = !!g.ticket || g.filing;
            return (
              <li
                key={g.id}
                {...dropOn(g.id, locked)}
                className={`min-w-0 rounded-[14px] border bg-surface transition-shadow ${
                  over === g.id ? "border-accent shadow-[0_0_0_3px_rgba(221,105,54,0.14)]" : "border-hairline"
                }`}
              >
                <GroupHead group={g} locked={locked} canFile={fileable.some((f) => f.id === g.id)} onRename={(title) => change(`/groups/${g.id}`, { title })} onFile={() => void fileOne(g.id)} />
                <ul className="border-t border-hairline py-1">
                  {g.reports.map((r) => (
                    <ReportRow
                      key={r.id}
                      report={r}
                      person={people[r.by]}
                      locked={locked}
                      targets={targets.filter((t) => t.id !== g.id)}
                      alone={g.reports.length === 1}
                      onMove={(to) => void change(`/reports/${r.id}`, { to })}
                      onDrop={() => void change(`/reports/${r.id}`, { drop: true })}
                    />
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      {review.dropped.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowDropped((s) => !s)}
            aria-expanded={showDropped}
            className="flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"
          >
            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform ${showDropped ? "rotate-90" : ""}`}>
              <path d="M6 3.5 10.5 8 6 12.5" />
            </svg>
            Left out
            <span className="tabular-nums">{review.dropped.length}</span>
          </button>
          {showDropped && (
            <ul className="mt-1.5">
              {review.dropped.map((r) => (
                <li key={r.id} className="flex items-center gap-2.5 py-1.5">
                  <Avatar name={people[r.by]?.name ?? "someone"} imageUrl={people[r.by]?.imageUrl} size={20} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-2">{r.title}</span>
                  <button type="button" onClick={() => void change(`/reports/${r.id}`, { to: "new" })} className="shrink-0 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-ink">
                    Put back
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function GroupHead({
  group: g,
  locked,
  canFile,
  onRename,
  onFile,
}: {
  group: ReviewGroup;
  locked: boolean;
  canFile: boolean;
  onRename: (title: string) => Promise<void>;
  onFile: () => void;
}) {
  // The title as typed; the server's when it changes underneath.
  const [title, setTitle] = useState(g.title);
  const [seen, setSeen] = useState(g.title);
  if (seen !== g.title) {
    setSeen(g.title);
    setTitle(g.title);
  }
  const save = () => {
    const next = title.replace(/\s+/g, " ").trim();
    if (!next) return setTitle(g.title);
    if (next !== g.title) void onRename(next);
  };

  return (
    <div className="flex items-start gap-x-3 gap-y-2 px-3.5 pb-2.5 pt-3 max-sm:flex-col max-sm:items-stretch">
      <div className="min-w-0 flex-1">
        {locked ? (
          <p className="text-[14px] font-semibold leading-snug text-ink [overflow-wrap:anywhere]">{g.title}</p>
        ) : (
          <input
            value={title}
            maxLength={MAX_GROUP_TITLE}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setTitle(g.title);
                e.currentTarget.blur();
              }
            }}
            aria-label="Ticket title"
            spellCheck={false}
            className="-mx-1.5 w-[calc(100%+0.75rem)] rounded-md bg-transparent px-1.5 py-0.5 text-[14px] font-semibold leading-snug text-ink outline-none transition-colors hover:bg-surface-2 focus:bg-surface-2"
          />
        )}
        {g.reports.length > 1 && (
          <span className="mt-1 inline-flex h-[22px] items-center gap-1.5 rounded-full bg-[var(--color-accent-soft)] px-2 text-[11.5px] font-medium tabular-nums text-accent">
            {g.reports.length} reports, one ticket
          </span>
        )}
        {g.error && !g.ticket && <p className="mt-1.5 text-[13px] text-[#c62828]">{g.error}</p>}
      </div>
      <div className="shrink-0 pt-0.5">
        {g.ticket ? (
          <a
            href={g.ticket.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] bg-[rgba(46,125,50,0.1)] px-2.5 text-[13px] font-medium text-[#2e7d32] no-underline hover:bg-[rgba(46,125,50,0.16)]"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12l5 5L20 6" />
            </svg>
            <span className="font-mono text-xs">{g.ticket.identifier ?? "Ticket"}</span>
          </a>
        ) : g.filing ? (
          <span className="inline-flex h-[30px] items-center gap-2 px-1 text-[13px] text-accent">
            <span className="dot-pulse h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            Creating
          </span>
        ) : (
          <button type="button" onClick={onFile} disabled={!canFile} className="btn h-[30px]">
            {g.error ? "Try again" : "Create ticket"}
          </button>
        )}
      </div>
    </div>
  );
}

function ReportRow({
  report: r,
  person,
  locked,
  targets,
  alone,
  onMove,
  onDrop,
}: {
  report: ReviewItem;
  person?: BashPerson;
  locked: boolean;
  /** The groups it could move to. */
  targets: ReviewGroup[];
  /** The only report of its group: a new group would change nothing. */
  alone: boolean;
  onMove: (to: string) => void;
  onDrop: () => void;
}) {
  const name = person?.name ?? "someone";
  return (
    <li
      draggable={!locked}
      onDragStart={
        locked
          ? undefined
          : (e) => {
              e.dataTransfer.setData(REPORT_DRAG_TYPE, r.id);
              e.dataTransfer.effectAllowed = "move";
            }
      }
      className={`group/r flex min-h-9 items-center gap-2.5 px-3.5 py-1 transition-colors duration-100 hover:bg-hover ${locked ? "" : "cursor-grab active:cursor-grabbing"}`}
    >
      <span title={name} className="flex shrink-0">
        <Avatar name={name} imageUrl={person?.imageUrl} size={20} />
        <span className="sr-only">{name}</span>
      </span>
      {r.shareId ? (
        <a href={`/b/${r.shareId}`} target="_blank" rel="noreferrer" draggable={false} className="min-w-0 flex-1 truncate text-[13.5px] text-ink-2 no-underline hover:text-ink hover:underline max-sm:line-clamp-2 max-sm:whitespace-normal">
          {r.title}
        </a>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-2">{r.title}</span>
      )}
      {r.writing && <span className="shrink-0 text-xs text-muted">Writing</span>}
      {r.unwritten && <span className="shrink-0 text-xs text-[#c62828]">Not written</span>}
      {!locked && (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/r:opacity-100 max-sm:opacity-100">
          {(targets.length > 0 || !alone) && (
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) onMove(e.target.value);
              }}
              aria-label={`Move ${r.title}`}
              className="h-7 max-w-[108px] cursor-pointer max-sm:max-w-[74px] rounded-md border-0 bg-transparent px-1.5 text-[13px] text-muted outline-none hover:bg-surface-2 hover:text-ink focus:bg-surface-2"
            >
              <option value="">Move</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
              {!alone && <option value="new">A ticket of its own</option>}
            </select>
          )}
          <button
            type="button"
            onClick={onDrop}
            title="Leave out"
            aria-label={`Leave out ${r.title}`}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-[#c62828]"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </span>
      )}
    </li>
  );
}
