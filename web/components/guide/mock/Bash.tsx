"use client";
import Crumbs from "@/components/Crumbs";
import BashRace from "@/components/BashRace";
import BashReview from "@/components/BashReview";
import CompetitionPanel from "@/components/CompetitionPanel";
import StartButton from "@/components/StartButton";
import { Ring } from "@/components/BashView";
import { DURATIONS, lengthLabel } from "@/lib/bash";
import type { BashBrief, BashPerson, BashReview as Review } from "@/lib/bash-server";
import type { PodiumEntry } from "@/lib/org-server";

/*
 * Quality competition in the Guide, from the app's own markup: the list (BashHome), the
 * form (BashNew), and a quality competition's page (BashView's header and Arena, then the
 * real BashRace board and the real BashReview). Drawn inside MockApp.
 */

const plus = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const sparkle = (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true" className="text-accent">
    <path d="M8 1.5c.4 2.9 1.7 4.2 4.6 4.6-2.9.4-4.2 1.7-4.6 4.6-.4-2.9-1.7-4.2-4.6-4.6 2.9-.4 4.2-1.7 4.6-4.6ZM12.5 10.5c.2 1.3.8 1.9 2.1 2.1-1.3.2-1.9.8-2.1 2.1-.2-1.3-.8-1.9-2.1-2.1 1.3-.2 1.9-.8 2.1-2.1Z" />
  </svg>
);

const SUGGESTED = [
  { name: "Checkout", bugs: 6, open: 4 },
  { name: "Search", bugs: 4, open: 2 },
];

/** The team's monthly competition, first on the list page. */
const MONTH: PodiumEntry[] = [
  { userId: "a", rank: 1, filed: 12, title: "chief bug officer", name: "Ana Ruiz", isYou: false },
  { userId: "y", rank: 2, filed: 9, title: "the closer", name: "You", isYou: true },
  { userId: "l", rank: 3, filed: 7, title: "on a tear", name: "Leo Martin", isYou: false },
];

export type BashListS = { newOn?: boolean; suggestOn?: boolean; rows?: Array<{ name: string; dates: string; people: number; fresh?: boolean }> };

/** BashHome: the tabs, a line per quality competition, Suggested and New quality competition at the top. */
export function MockBashList({ s }: { s: BashListS }) {
  const rows = s.rows ?? [];
  return (
    <div className="w-full">
      <header className="flex items-center justify-between gap-4">
        <h1 className="page-title">Quality competition</h1>
        <span className="flex shrink-0 items-center gap-1.5">
          <div className="relative">
            <span data-gd="bash-suggested" className={`btn h-[30px] gap-1.5 ${s.suggestOn ? "bg-[var(--color-pressed)]" : ""}`}>
              {sparkle}
              Suggested
              <span className="tabular-nums text-faint">{SUGGESTED.length}</span>
            </span>
            {s.suggestOn && (
              <div className="menu gd-pop absolute right-0 top-full z-40 mt-1 w-[280px] p-1">
                {SUGGESTED.map((x, i) => (
                  <span key={x.name} className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${i === 0 ? "bg-[var(--color-hover)]" : ""}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{x.name}</span>
                      <span className="block truncate text-[12px] tabular-nums text-muted">
                        {x.bugs} bugs · {x.open} open
                      </span>
                    </span>
                    <span className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium ${i === 0 ? "bg-accent text-cream" : "text-muted"}`}>Create</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <span data-gd="bash-new" className={`btn-accent h-[30px] shrink-0${s.newOn ? " gd-press" : ""}`}>
            {plus}
            New quality competition
          </span>
        </span>
      </header>

      <div className="mt-4">
        <CompetitionPanel month={MONTH} all={MONTH} orgName="Acme" quipSeed={1} />
      </div>

      <div className="-ml-2 mt-5 flex flex-wrap items-center gap-0.5">
        {(
          [
            ["Assigned to me", rows.length],
            ["All", rows.length],
            ["Closed", 0],
          ] as const
        ).map(([t, n], i) => (
          <span key={t} aria-selected={i === 0} className="tab">
            <span className="truncate">{t}</span>
            <span className="tab-count">{n}</span>
          </span>
        ))}
      </div>

      <div className="mt-4">
        {rows.length > 0 ? (
          <ul className="-mx-2.5">
            {rows.map((b) => (
              <li key={b.name} className={`list-row${b.fresh ? " animate-rise" : ""}`}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="relative shrink-0 text-accent">
                  <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M8 2a6 6 0 0 1 0 12Z" fill="currentColor" />
                </svg>
                <span className="min-w-0 flex-1 truncate text-[13.5px] leading-snug text-ink">{b.name}</span>
                <span className="relative z-10 flex shrink-0 items-center gap-2">
                  <span className="text-[12.5px] tabular-nums text-muted">2d left</span>
                  <span className="btn-accent h-7 !px-2.5 !py-0">Start 30 min</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-[14px] border border-dashed border-[var(--color-line)] px-4 py-12 text-center">
            <p className="text-[14px] font-medium text-ink">Nothing assigned to you</p>
          </div>
        )}
      </div>
    </div>
  );
}

export type BashNewS = { name?: string; typing?: boolean; hold?: boolean; holdOn?: boolean; createOn?: boolean };

/** BashNew: the name (with the suggested areas under it), the dates, the duration, Review before filing. */
export function MockBashNew({ s }: { s: BashNewS }) {
  const label = "text-[12.5px] font-medium text-ink-2";
  const dateInput = "mt-1.5 flex h-10 w-full items-center rounded-[10px] border border-hairline bg-surface px-3 text-[14px] tabular-nums text-ink";
  const hold = s.hold ?? true;
  return (
    <div className="w-full max-w-[640px]">
      <Crumbs items={[{ label: "Quality competition", href: "/competition" }, { label: "New" }]} />
      <h1 className="mt-3 page-title">New quality competition</h1>
      <div className="card mt-5 p-6">
        <span className={label}>Name</span>
        <div data-gd="bash-name" className={`mt-1.5 flex h-10 w-full items-center rounded-[10px] border bg-surface px-3 text-[15px] font-medium text-ink ${s.typing ? "border-accent" : "border-hairline"}`}>
          {s.name ? <span className={s.typing ? "gd-type gd-caret" : ""}>{s.name}</span> : <span className="font-normal text-[rgba(26,22,18,0.3)]">Release 2.4</span>}
        </div>
        <div className="mt-3">
          <span className="text-xs text-muted">Suggested</span>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {SUGGESTED.map((x) => (
              <li key={x.name}>
                <span className={`inline-block rounded-full border px-2.5 py-1 text-[13px] ${s.name === x.name && !s.typing ? "border-accent bg-accent/[0.06] text-ink" : "border-hairline text-ink-2"}`}>
                  {x.name}
                  <span className="ml-1.5 tabular-nums text-muted">{x.bugs} bugs</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4">
          <div>
            <span className={label}>Start date</span>
            <div className={dateInput}>15/11/2026</div>
          </div>
          <div>
            <span className={label}>End date</span>
            <div className={dateInput}>18/11/2026</div>
          </div>
        </div>
        <span className={`mt-5 block ${label}`}>Duration</span>
        <div className="mt-1.5 grid gap-1 rounded-[12px] bg-surface-2 p-1" style={{ gridTemplateColumns: `repeat(${DURATIONS.length}, minmax(0, 1fr))` }}>
          {DURATIONS.map((m) => (
            <span key={m} className={`rounded-[9px] py-2 text-center text-[13.5px] tabular-nums ${m === 30 ? "bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(26,22,18,.08),0_0_0_1px_rgba(26,22,18,.06)]" : "text-muted"}`}>
              {lengthLabel(m)}
            </span>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">Each person gets this much time, from when they press Start.</p>
        <div data-gd="bash-hold" className={`-mx-2 mt-3 flex items-center justify-between gap-3 rounded-[10px] px-2 py-2 ${s.holdOn ? "bg-[var(--color-hover)]" : ""}`}>
          <span className="text-[13.5px] text-ink">Review before filing</span>
          <span className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors ${hold ? "bg-accent" : "bg-[rgba(26,22,18,0.18)]"}`}>
            <span className={`absolute left-[3px] top-[3px] h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.2)] transition-transform ${hold ? "translate-x-[18px]" : ""}`} />
          </span>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <span className="btn h-9">Cancel</span>
          <span data-gd="bash-create" className={`btn-accent h-9${s.name ? "" : " opacity-50"}${s.createOn ? " gd-press" : ""}`}>
            Create
          </span>
        </div>
      </div>
    </div>
  );
}

export type BashPageS = {
  copied?: boolean;
  copyOn?: boolean;
  /** Where you stand: not in it (Join), in it (Start), your clock running. */
  me?: "join" | "start" | "testing";
  meOn?: boolean;
  /** Your time left, in seconds. */
  left?: number;
  /** The board: each person's count. Sam, Ana, you, Lee. */
  counts?: [number, number, number, number];
  /** Who has joined so far (the first n of Sam, Ana, you, Lee). */
  joined?: number;
  review?: boolean;
  filed?: boolean;
};

const NOW = Date.UTC(2026, 10, 15, 15, 0, 0);
const NAMES = ["Sam Rivera", "Ana Costa", "Razi", "Lee Park"];
const FINDS = ["Pay button does nothing", "Coupon accepts expired codes", "Card form loses the postcode", "Total ignores the discount", "Pay spins forever on retry", "Empty cart shows $0.00 shipping", "Can't remove the last item"];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The people and their finds, as the quality competition's snapshot gives them. */
function board(s: BashPageS): { people: BashPerson[]; briefs: BashBrief[] } {
  const counts = s.counts ?? [0, 0, 0, 0];
  const joined = s.joined ?? 4;
  const raw = NAMES.slice(0, joined).map((name, i) => ({ i, name, count: counts[i], you: i === 2 }));
  const sorted = [...raw].sort((a, b) => b.count - a.count || a.i - b.i);
  const people: BashPerson[] = sorted.map((p, r) => ({
    key: `p${p.i}`,
    name: p.name,
    isYou: p.you,
    count: p.count,
    rank: r + 1,
    endsAt: p.you && s.me !== "testing" ? null : new Date(NOW + 20 * 60000).toISOString(),
  }));
  const briefs: BashBrief[] = [];
  let n = 0;
  sorted.forEach((p, idx) => {
    for (let k = 0; k < p.count; k++) briefs.push({ id: `b${n}`, title: FINDS[n++ % FINDS.length], by: idx, createdAt: new Date(NOW - (n * 3 + 30) * 60000).toISOString() });
  });
  return { people, briefs: briefs.reverse() };
}

const REVIEW: Review = {
  grouped: true,
  dropped: [],
  groups: [
    {
      id: "g1",
      title: "Pay button does nothing at checkout",
      filing: false,
      reports: [
        { id: "r1", title: "Pay button does nothing", by: 0, writing: false, unwritten: false },
        { id: "r2", title: "Nothing happens when I click Pay", by: 1, writing: false, unwritten: false },
        { id: "r3", title: "Can't pay, the button is dead", by: 2, writing: false, unwritten: false },
      ],
    },
    {
      id: "g2",
      title: "Coupon field accepts expired codes",
      filing: false,
      reports: [
        { id: "r4", title: "Coupon accepts expired codes", by: 1, writing: false, unwritten: false },
        { id: "r5", title: "EXPIRED10 still gives 10% off", by: 3, writing: false, unwritten: false },
      ],
    },
  ],
};

/** A quality competition's page: BashView's header and Arena, the real BashRace, and the real BashReview once it is over. */
export function MockBashPage({ s }: { s: BashPageS }) {
  const { people, briefs } = board(s);
  const closed = !!s.review;
  const live = people.filter((p) => p.endsAt !== null && !p.isYou).length;
  const review: Review = s.filed ? { ...REVIEW, groups: REVIEW.groups.map((g) => ({ ...g, ticket: { url: "#", identifier: g.id === "g1" ? "ENG-151" : "ENG-152" } })) } : REVIEW;
  return (
    <div className="w-full">
      <Crumbs items={[{ label: "Quality competition", href: "/competition" }, { label: "Checkout" }]} />
      <header className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">Checkout</h1>
          <p className="mt-2">
            {closed ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(26,22,18,0.06)] px-2.5 py-0.5 text-[12.5px] font-medium tabular-nums text-ink-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[#b9b2a4]" aria-hidden />
                Closed
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-0.5 text-[12.5px] font-medium tabular-nums text-accent">
                <span className="dot-pulse h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                2d left
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {closed ? (
            <span className="btn h-[30px]">Copy report</span>
          ) : (
            <span data-gd="bash-copy" className={`btn h-[30px]${s.copyOn ? " gd-press" : ""}`}>
              {s.copied ? "Link copied" : "Invite"}
            </span>
          )}
          {s.me === "join" && (
            <span data-gd="bash-join" className={`btn-accent h-[30px]${s.meOn ? " gd-press" : ""}`}>
              Join
            </span>
          )}
        </div>
      </header>

      {!closed && (
        <section className="arena mt-6 flex flex-wrap items-center gap-x-7 gap-y-4 rounded-[16px] border border-hairline bg-surface px-5 py-4">
          <div className="flex items-center gap-3.5">
            {s.me === "testing" ? (
              <Ring progress={(s.left ?? 1800) / 1800} label="Your time" icon="watch">
                <span className="text-accent">{clock(s.left ?? 1800)}</span>
              </Ring>
            ) : (
              <span data-gd="bash-start" className={`inline-flex${s.me === "join" ? " opacity-50" : ""}`}>
                <StartButton label="Start my 30 min" pressed={!!s.meOn && s.me === "start"} />
              </span>
            )}
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-x-8 gap-y-3">
            {briefs.length > 0 && (
            <div>
              <div className="text-[12.5px] text-muted">{briefs.length === 1 ? "Bug found" : "Bugs found"}</div>
              <div className="mt-0.5 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">{briefs.length}</div>
            </div>
            )}
            {live > 0 && (
            <div>
              <div className="text-[12.5px] text-muted">Testing now</div>
              <div className="mt-0.5 flex items-center gap-2 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">
                {live}
                <span className="dot-pulse h-2 w-2 rounded-full bg-accent" aria-hidden />
              </div>
            </div>
            )}
          </div>
        </section>
      )}

      {!closed && <BashRace people={people} briefs={briefs} open closed={false} now={NOW} />}

      {closed && (
        <div className="relative mt-8">
          {/* where the review's "Create 2 tickets" sits, for the cursor */}
          <span data-gd="bash-file" aria-hidden className="absolute right-0 top-0 h-[30px] w-[132px]" />
          <BashReview code="guide" review={review} people={people} onChange={async () => {}} />
        </div>
      )}
    </div>
  );
}
