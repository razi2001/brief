"use client";

import { useEffect, useMemo, useState } from "react";
import Avatar from "./Avatar";
import RefreshButton from "./RefreshButton";
import { TrackerLogo } from "./TrackerLogo";
import type { ProviderKey } from "@/lib/tracker";
import {
  DEFAULT_FILTERS,
  NO_ORG,
  filterRows,
  filtersToQuery,
  kindCounts,
  orgOptions,
  personOptions,
  type AdminFilters,
  type AdminRow,
  type KindFilter,
} from "@/lib/admin-view";

const KINDS: { key: KindFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ticket", label: "Tickets" },
  { key: "draft", label: "Drafts" },
];

// Person takes the slack; the rest are fixed so every row lines up.
const GRID = "sm:grid sm:grid-cols-[minmax(0,1fr)_160px_120px_112px_48px] sm:items-center sm:gap-x-4";

function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 60) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.round(mo / 12)}y`;
}

function statusOf(r: AdminRow): { label: string; color: string } {
  if (r.kind === "draft") {
    return r.status === "processing" ? { label: "Writing…", color: "#dd6936" } : { label: "Draft", color: "#8a8378" };
  }
  if (r.status === "failed") return { label: "Didn't file", color: "#c62828" };
  if (r.status === "processing") return { label: "Filing…", color: "#dd6936" };
  return { label: "Filed", color: "#2e7d32" };
}

function Row({ r }: { r: AdminRow }) {
  const status = statusOf(r);
  const when = r.createdAt ? new Date(r.createdAt) : null;
  return (
    <li className={`flex items-center gap-3 px-4 py-2.5 ${GRID} ${r.deleted ? "opacity-60" : ""}`}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Avatar name={r.personName} imageUrl={r.personImage ?? undefined} size={22} />
        <div className="min-w-0">
          <div className="truncate text-[13px] text-ink-2">{r.personName}</div>
          <div className="truncate text-[11px] text-muted">
            {r.personEmail}
            <span className="sm:hidden">
              {r.personEmail ? " · " : ""}
              {r.orgName} · {status.label}
            </span>
          </div>
        </div>
        {r.deleted && <span className="pill shrink-0 !py-0 text-[10.5px]">Deleted</span>}
      </div>

      <span className="hidden truncate text-[13px] text-ink-2 sm:block">{r.orgName}</span>

      <span className="hidden min-w-0 items-center gap-1.5 text-[12.5px] text-ink-2 sm:flex">
        {r.provider && <TrackerLogo kind={r.provider as ProviderKey} size={12} />}
        <span className="truncate">{r.kind === "draft" ? "Draft" : "Ticket"}</span>
      </span>

      <span className="hidden min-w-0 items-center gap-1.5 text-[12.5px] text-ink-2 sm:flex">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
        <span className="truncate">{status.label}</span>
      </span>

      <span
        className="shrink-0 text-xs tabular-nums text-muted"
        title={when ? when.toLocaleString() : undefined}
        suppressHydrationWarning
      >
        {relativeTime(r.createdAt)}
      </span>
    </li>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; count: number }[];
  allLabel: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`btn h-8 max-w-[220px] cursor-pointer truncate !pr-2 ${value ? "!border-accent/40 !text-ink" : ""}`}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label} ({o.count})
        </option>
      ))}
    </select>
  );
}

/**
 * The owner's monitoring view: who made a ticket or draft, in which org, for
 * which tracker, and whether it filed. Never what it says: rows carry no
 * title, text or link (lib/admin-view OWNER_FIELDS). Filters live in the URL
 * so a filtered view can be bookmarked.
 */
export default function AdminView({ rows, initial }: { rows: AdminRow[]; initial: AdminFilters }) {
  const [filters, setFilters] = useState<AdminFilters>(initial);
  const set = (patch: Partial<AdminFilters>) => setFilters((f) => ({ ...f, ...patch }));

  // replaceState keeps the URL in step without a server round trip per keystroke.
  useEffect(() => {
    window.history.replaceState(null, "", `${window.location.pathname}${filtersToQuery(filters)}`);
  }, [filters]);

  const orgs = useMemo(() => orgOptions(rows, filters.deleted), [rows, filters.deleted]);
  const people = useMemo(() => personOptions(rows, filters.org, filters.deleted), [rows, filters.org, filters.deleted]);
  const visible = useMemo(() => filterRows(rows, filters), [rows, filters]);
  const counts = useMemo(() => kindCounts(rows, filters), [rows, filters]);

  // Picking an org that person isn't in drops the person, rather than showing nothing.
  const pickOrg = (org: string) =>
    setFilters((f) => ({
      ...f,
      org,
      person: f.person && !personOptions(rows, org, f.deleted).some((p) => p.value === f.person) ? "" : f.person,
    }));

  const filtered =
    filters.kind !== "all" || !!filters.org || !!filters.person || !!filters.q.trim() || filters.deleted;

  const totals = useMemo(() => {
    const live = rows.filter((r) => !r.deleted);
    return {
      tickets: live.filter((r) => r.kind === "ticket").length,
      drafts: live.filter((r) => r.kind === "draft").length,
      people: new Set(live.map((r) => r.userId)).size,
      orgs: new Set(live.flatMap((r) => (r.orgKey === NO_ORG ? [] : [r.orgKey]))).size,
    };
  }, [rows]);

  return (
    <section>
      <header className="flex items-center justify-between gap-4">
        <h1 className="page-title">Usage</h1>
        <div className="flex shrink-0 items-center gap-2">
          <RefreshButton />
        </div>
      </header>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] tabular-nums text-muted">
        <span>{totals.tickets} tickets</span>
        <span>{totals.drafts} drafts</span>
        <span>{totals.people} people</span>
        <span>{totals.orgs} orgs</span>
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Kind" className="inline-flex h-8 items-center rounded-lg border border-hairline bg-surface-2 p-0.5">
          {KINDS.map((k) => {
            const active = filters.kind === k.key;
            return (
              <button
                key={k.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => set({ kind: k.key })}
                className={`inline-flex h-full items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors ${
                  active ? "bg-surface text-ink shadow-[0_1px_2px_rgba(26,22,18,.08)]" : "text-ink-2/75 hover:text-ink"
                }`}
              >
                {k.label}
                <span className="tabular-nums text-muted">{counts[k.key]}</span>
              </button>
            );
          })}
        </div>
        <Select label="Organization" value={filters.org} onChange={pickOrg} options={orgs} allLabel="All organizations" />
        <Select label="Person" value={filters.person} onChange={(person) => set({ person })} options={people} allLabel="Everyone" />
        <input
          type="search"
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Person, email or org"
          aria-label="Search"
          className="btn h-8 min-w-[160px] flex-1 cursor-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/25 sm:max-w-[260px]"
        />
        <label className="inline-flex h-8 cursor-pointer select-none items-center gap-2 px-1 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={filters.deleted}
            onChange={(e) => set({ deleted: e.target.checked })}
            className="h-3.5 w-3.5 accent-[#dd6936]"
          />
          Include deleted
        </label>
        {filtered && (
          <button type="button" onClick={() => setFilters(DEFAULT_FILTERS)} className="btn h-8">
            Clear
          </button>
        )}
      </div>

      <div className="card mt-4 overflow-hidden p-0">
        <div className={`hidden border-b border-hairline px-4 py-2 text-xs font-medium text-muted ${GRID}`}>
          <span>Person</span>
          <span>Organization</span>
          <span>Kind</span>
          <span>Status</span>
          <span>Created</span>
        </div>
        {visible.length > 0 ? (
          <ul className="divide-y divide-hairline">
            {visible.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-14 text-center text-[14px] font-medium text-ink">Nothing matches</p>
        )}
      </div>
    </section>
  );
}
