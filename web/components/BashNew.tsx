"use client";

import Link from "next/link";
import Crumbs from "./Crumbs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_DURATION, DEFAULT_OPEN_DAYS, DURATIONS, HOLDS_BY_DEFAULT, MAX_BASH_NAME, MAX_OPEN_DAYS, lengthLabel } from "@/lib/bash";
import type { Suggestion } from "@/lib/bash-suggest";

/** A date as a date input holds it (the day in this browser's own time zone). */
function inputDay(d: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** The start of that day, here; today means now. */
function startOf(day: string, today: string): Date {
  if (day === today) return new Date();
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}
/** The end of that day, here. */
function endOfDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59);
}

/**
 * New bug bash, on its own page: a name, a start date, an end date, a
 * duration (the time each person gets, on their own clock), and whether the
 * reports wait for a review. Creating it opens its page, where the link to
 * share is; Cancel goes back to the list.
 *
 * Under the name, when the tickets already filed cluster somewhere, Brief
 * suggests those areas as names ("Checkout, 6 bugs"). Picking one fills the
 * name in. With nothing to suggest, nothing shows.
 */
/** suggested: the answer the server already kept, drawn with the form; null when it has none yet, and then it is asked once the form shows. */
export default function BashNew({ suggested = null }: { suggested?: Suggestion[] | null } = {}) {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  // Today, as this browser sees it, fixed for the life of the form.
  const [today] = useState(() => inputDay(new Date()));
  const [name, setName] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => inputDay(addDays(new Date(), DEFAULT_OPEN_DAYS)));
  const [minutes, setMinutes] = useState<number>(DEFAULT_DURATION);
  const [hold, setHold] = useState<boolean>(HOLDS_BY_DEFAULT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(suggested ?? []);
  // What the server gave as the page first drew: only without it is it asked.
  const [given] = useState(suggested !== null);

  useEffect(() => {
    nameRef.current?.focus();
    // Asked once the form is drawn: reading the tickets takes a few seconds,
    // and an empty answer is a normal one.
    if (given) return;
    let on = true;
    fetch("/api/bashes/suggestions", { credentials: "same-origin" })
      .then((r) => (r.ok && !r.redirected ? r.json() : { suggestions: [] }))
      .then((d: { suggestions?: Suggestion[] }) => {
        if (on && Array.isArray(d.suggestions)) setSuggestions(d.suggestions);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [given]);

  const lastDay = from ? inputDay(addDays(startOf(from, ""), MAX_OPEN_DAYS)) : undefined;
  const datesOk = !!from && !!to && to >= from && from >= today;

  const create = async () => {
    if (!name.trim() || !datesOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bashes", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, minutes, hold, startsAt: startOf(from, today).toISOString(), endsAt: endOfDay(to).toISOString() }),
      });
      // A signed-out call is redirected to the sign-in page, which answers 200.
      if (res.ok && !res.redirected) {
        const { code } = (await res.json()) as { code: string };
        router.push(`/bash/${code}`);
        return;
      }
      const why = res.status === 400 ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
      setError(
        res.status === 429
          ? "That's enough for today. Try again tomorrow"
          : why === "dates"
            ? `Check the dates: at most ${MAX_OPEN_DAYS} days, ending after it starts`
            : "Couldn't create it. Try again",
      );
    } catch {
      setError("Couldn't create it. Try again");
    }
    setBusy(false);
  };

  const label = "text-[12.5px] font-medium text-ink-2";
  const dateInput =
    "mt-1.5 h-10 w-full rounded-[10px] border border-hairline bg-surface px-3 text-[14px] tabular-nums text-ink outline-none transition-colors focus:border-accent";

  return (
    <div className="w-full max-w-[640px]">
      <Crumbs items={[{ label: "Bug bash", href: "/bash" }, { label: "New" }]} />
      <h1 className="mt-3 page-title">New bug bash</h1>

      <form
        className="card mt-5 p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label htmlFor="bash-name" className={label}>
          Name
        </label>
        <input
          id="bash-name"
          ref={nameRef}
          value={name}
          maxLength={MAX_BASH_NAME}
          onChange={(e) => setName(e.target.value)}
          placeholder="Release 2.4"
          autoComplete="off"
          spellCheck={false}
          className="mt-1.5 h-10 w-full rounded-[10px] border border-hairline bg-surface px-3 text-[15px] font-medium text-ink outline-none transition-colors placeholder:font-normal placeholder:text-[rgba(26,22,18,0.3)] focus:border-accent"
        />
        {suggestions.length > 0 && (
          <div className="animate-rise mt-3">
            <span id="bash-suggested" className="text-xs text-muted">
              Suggested
            </span>
            <ul aria-labelledby="bash-suggested" className="mt-1.5 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <li key={s.name}>
                  <button
                    type="button"
                    onClick={() => {
                      setName(s.name);
                      nameRef.current?.focus();
                    }}
                    aria-pressed={name === s.name}
                    className={`rounded-full border px-2.5 py-1 text-[13px] transition-colors ${
                      name === s.name ? "border-accent bg-accent/[0.06] text-ink" : "border-hairline text-ink-2 hover:bg-surface-2"
                    }`}
                  >
                    {s.name}
                    <span className="ml-1.5 tabular-nums text-muted">
                      {s.bugs} {s.bugs === 1 ? "bug" : "bugs"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="bash-from" className={label}>
              Start date
            </label>
            <input
              id="bash-from"
              type="date"
              required
              value={from}
              min={today}
              onChange={(e) => {
                const v = e.target.value;
                setFrom(v);
                // keep the end after the start
                if (v && to < v) setTo(v);
              }}
              className={dateInput}
            />
          </div>
          <div>
            <label htmlFor="bash-to" className={label}>
              End date
            </label>
            <input id="bash-to" type="date" required value={to} min={from || today} max={lastDay} onChange={(e) => setTo(e.target.value)} className={dateInput} />
          </div>
        </div>

        <span id="bash-duration" className={`mt-5 block ${label}`}>
          Duration
        </span>
        <div
          role="radiogroup"
          aria-labelledby="bash-duration"
          className="mt-1.5 grid gap-1 rounded-[12px] bg-surface-2 p-1"
          style={{ gridTemplateColumns: `repeat(${DURATIONS.length}, minmax(0, 1fr))` }}
        >
          {DURATIONS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={minutes === m}
              aria-label={m < 60 ? `${m} minutes` : `${m / 60} ${m === 60 ? "hour" : "hours"}`}
              onClick={() => setMinutes(m)}
              className={`rounded-[9px] py-2 text-center text-[13.5px] tabular-nums transition-colors ${
                minutes === m ? "bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(26,22,18,.08),0_0_0_1px_rgba(26,22,18,.06)]" : "text-muted hover:text-ink"
              }`}
            >
              {lengthLabel(m)}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">Each person gets this much time, from when they press Start.</p>

        <div className="mt-5 flex items-center justify-between gap-3">
          <span id="bash-hold" className="text-[13.5px] text-ink">
            Review before filing
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={hold}
            aria-labelledby="bash-hold"
            onClick={() => setHold(!hold)}
            className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors ${hold ? "bg-accent" : "bg-[rgba(26,22,18,0.18)]"}`}
          >
            <span
              className={`absolute left-[3px] top-[3px] h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.2)] transition-transform ${hold ? "translate-x-[18px]" : ""}`}
            />
          </button>
        </div>

        {error && <p className="mt-4 text-[13px] text-[#c62828]">{error}</p>}
        <div className="mt-6 flex items-center justify-end gap-2">
          <Link href="/bash" className="btn h-9">
            Cancel
          </Link>
          <button type="submit" disabled={!name.trim() || !datesOk || busy} className="btn-accent h-9">
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
