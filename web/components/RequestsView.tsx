"use client";

import { useMemo, useState } from "react";
import { fieldFocusClass } from "./SettingsSection";
import { ago } from "@/lib/activity";
import {
  MAX_BODY,
  MAX_TITLE,
  STATUSES,
  STATUS_COLOR,
  STATUS_LABEL,
  filterRequests,
  sortRequests,
  statusCounts,
  type RequestItem,
  type RequestSort,
  type RequestStatus,
  type StatusFilter,
} from "@/lib/requests";

const inputClass = `block w-full rounded-lg border hairline bg-surface px-3 py-2 text-[14px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted/60 ${fieldFocusClass}`;

const SORTS: { key: RequestSort; label: string }[] = [
  { key: "top", label: "Top" },
  { key: "new", label: "New" },
];

/** What the composer says when a send is refused. */
const SEND_ERRORS: Record<number, string> = {
  429: "That's five today. More tomorrow.",
  400: "Add a few more words.",
};

/** The response, or null when nothing real came back. */
async function send(url: string, method: string, body: unknown): Promise<Response | null> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    // A signed-out session is answered with a redirect to /sign-in, which fetch
    // follows into a 200 page: that is a failure, not a save.
    return res.redirected ? null : res;
  } catch {
    return null;
  }
}

function Dot({ status }: { status: RequestStatus }) {
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[status] }} />;
}

/** The owner's status control: a pill that is really a select, so one click and one pick changes it. */
function StatusSelect({ item, onChange }: { item: RequestItem; onChange: (s: RequestStatus) => void }) {
  return (
    <label className="pill relative cursor-pointer gap-2 bg-surface pr-2 text-ink-2 transition-colors focus-within:ring-[3px] focus-within:ring-accent/20 hover:bg-surface-2">
      <Dot status={item.status} />
      <select
        aria-label={`Status of ${item.title}`}
        value={item.status}
        onChange={(e) => onChange(e.target.value as RequestStatus)}
        className="cursor-pointer appearance-none bg-transparent pr-4 text-xs font-medium text-ink-2 outline-none"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <svg viewBox="0 0 10 6" width="8" height="5" className="pointer-events-none absolute right-2.5 text-muted" aria-hidden="true">
        <path d="m1 1 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}

function StatusPill({ status }: { status: RequestStatus }) {
  return (
    <span className="pill gap-2 bg-surface text-ink-2">
      <Dot status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** A thumbs up: an outline until you've voted, then filled in the accent. */
function ThumbsUp({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="transition-transform duration-150 group-hover:-rotate-6 group-active:scale-90"
    >
      <path
        d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"
        fill={filled ? "currentColor" : "none"}
      />
      {/* the cuff: drawn light on a filled hand so it still reads */}
      <path d="M7 10v12" stroke={filled ? "#fffdfa" : "currentColor"} />
    </svg>
  );
}

function VoteButton({ item, busy, onToggle }: { item: RequestItem; busy: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-pressed={item.voted}
      aria-label={`${item.voted ? "Remove your vote from" : "Vote for"} ${item.title}`}
      className={`group flex h-14 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border text-[12px] font-semibold tabular-nums transition-colors disabled:cursor-wait ${
        item.voted
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-hairline bg-surface text-ink-2 hover:border-accent/30 hover:bg-accent/5 hover:text-accent"
      }`}
    >
      <ThumbsUp filled={item.voted} />
      {item.votes}
    </button>
  );
}

function Composer({ onCreated }: { onCreated: (item: RequestItem) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending || title.trim().length < 3) return;
    setSending(true);
    setError("");
    const res = await send("/api/requests", "POST", { title, body });
    setSending(false);
    if (!res || !res.ok) {
      setError(res ? (SEND_ERRORS[res.status] ?? "Couldn't send. Try again.") : "Couldn't send. Try again.");
      return;
    }
    const data = (await res.json()) as { id: string; createdAt: string };
    onCreated({
      id: data.id,
      title: title.replace(/\s+/g, " ").trim(),
      body: body.trim(),
      status: "open",
      createdAt: data.createdAt,
      votes: 1,
      voted: true,
      mine: true,
    });
    setTitle("");
    setBody("");
  }

  return (
    <form onSubmit={submit} className="card mt-6 p-3">
      <div className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={MAX_TITLE}
          placeholder="What should Brief do?"
          aria-label="Request"
          className={inputClass}
        />
        <button type="submit" disabled={sending || title.trim().length < 3} className="btn-accent shrink-0">
          Send
        </button>
      </div>
      {title.trim() !== "" && (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_BODY}
          rows={3}
          placeholder="Details (optional)"
          aria-label="Details"
          className={`mt-2 resize-y ${inputClass}`}
        />
      )}
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-[#c62828]">
          {error}
        </p>
      )}
    </form>
  );
}

function Row({
  item,
  admin,
  busy,
  now,
  onVote,
  onStatus,
  onDelete,
}: {
  item: RequestItem;
  admin: boolean;
  busy: boolean;
  now: number;
  onVote: () => void;
  onStatus: (s: RequestStatus) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    // Vote | text | status in a row from sm up; on a phone the status drops
    // under the text so the title keeps its width.
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3.5 gap-y-2 px-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <div className="row-span-2 sm:row-span-1">
        <VoteButton item={item} busy={busy} onToggle={onVote} />
      </div>
      <div className="min-w-0 flex-1">
        {/* Everything shows in full: no clamping, and a long unbroken string wraps. */}
        <p className="whitespace-pre-wrap text-[15px] font-medium leading-snug text-ink [overflow-wrap:anywhere]">{item.title}</p>
        {item.body && (
          <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{item.body}</p>
        )}
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {item.mine && (
            <>
              <span>You</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span>{ago(item.createdAt, now)}</span>
          {/* Your own, or any at all for the owner (the server decides again). */}
          {(item.mine || admin) &&
            (confirming ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-ink-2">Delete this request?</span>
                <button
                  type="button"
                  onClick={onDelete}
                  aria-label={`Confirm delete ${item.title}`}
                  className="font-medium text-[#c62828] hover:underline"
                >
                  Delete
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="hover:text-ink">
                  Keep
                </button>
              </>
            ) : (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  aria-label={`Delete ${item.title}`}
                  className="transition-colors hover:text-[#c62828]"
                >
                  Delete
                </button>
              </>
            ))}
        </div>
      </div>
      <div className="col-start-2 justify-self-start sm:col-start-3 sm:row-start-1 sm:justify-self-end sm:pt-0.5">
        {admin ? <StatusSelect item={item} onChange={onStatus} /> : <StatusPill status={item.status} />}
      </div>
    </li>
  );
}

export default function RequestsView({ initial, admin }: { initial: RequestItem[]; admin: boolean }) {
  const [items, setItems] = useState(initial);
  const [sort, setSort] = useState<RequestSort>("top");
  const [filter, setFilter] = useState<StatusFilter>("all");
  // Rows with a vote on its way: the button waits, so answers can't cross.
  const [voting, setVoting] = useState<ReadonlySet<string>>(new Set());
  const [now] = useState(() => Date.now());

  const counts = useMemo(() => statusCounts(items), [items]);
  const shown = useMemo(() => sortRequests(filterRequests(items, filter), sort), [items, filter, sort]);

  const patch = (id: string, change: Partial<RequestItem>) =>
    setItems((all) => all.map((i) => (i.id === id ? { ...i, ...change } : i)));

  async function vote(item: RequestItem) {
    const voted = !item.voted;
    patch(item.id, { voted, votes: item.votes + (voted ? 1 : -1) });
    setVoting((s) => new Set(s).add(item.id));
    const res = await send(`/api/requests/${item.id}/vote`, "POST", { voted });
    setVoting((s) => {
      const next = new Set(s);
      next.delete(item.id);
      return next;
    });
    if (!res?.ok) patch(item.id, { voted: item.voted, votes: item.votes });
  }

  async function remove(item: RequestItem) {
    setItems((all) => all.filter((i) => i.id !== item.id));
    const res = await send(`/api/requests/${item.id}`, "DELETE", undefined);
    // 404 means it was already gone, which is what was asked for. Anything
    // else puts the request back.
    if (!res?.ok && res?.status !== 404) setItems((all) => (all.some((i) => i.id === item.id) ? all : [item, ...all]));
  }

  async function setStatus(item: RequestItem, status: RequestStatus) {
    patch(item.id, { status });
    const res = await send(`/api/requests/${item.id}`, "PATCH", { status });
    if (!res?.ok) patch(item.id, { status: item.status });
  }

  const chips: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    ...STATUSES.filter((s) => counts[s] > 0 || s === filter).map((s) => ({ key: s, label: STATUS_LABEL[s] })),
  ];

  return (
    <div className="mx-auto w-full max-w-[720px]">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">Feature requests</h1>
          <p className="mt-1.5 text-[13.5px] leading-snug text-ink-2/70">
            Help us build Brief. Send an idea, vote for what matters, and see it ship.
          </p>
        </div>
        <div role="group" aria-label="Sort" className="flex shrink-0 rounded-lg border hairline bg-surface p-0.5">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={sort === s.key}
              onClick={() => setSort(s.key)}
              className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors ${
                sort === s.key ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      <Composer onCreated={(item) => setItems((all) => [item, ...all])} />

      {chips.length > 2 && (
        <div role="group" aria-label="Status" className="mt-5 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={filter === c.key}
              onClick={() => setFilter(c.key)}
              className={`rounded-full border px-2.5 py-1 text-[13px] font-medium tabular-nums transition-colors ${
                filter === c.key
                  ? "border-ink/80 bg-ink text-cream"
                  : "border-hairline bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink"
              }`}
            >
              {c.label} <span className={filter === c.key ? "text-cream/70" : "text-muted"}>{counts[c.key]}</span>
            </button>
          ))}
        </div>
      )}

      {shown.length > 0 && (
        <ul className="card mt-4 divide-y divide-[color:var(--color-hairline)] overflow-hidden">
          {shown.map((item) => (
            <Row
              key={item.id}
              item={item}
              admin={admin}
              busy={voting.has(item.id)}
              now={now}
              onVote={() => vote(item)}
              onStatus={(s) => setStatus(item, s)}
              onDelete={() => remove(item)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
