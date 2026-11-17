"use client";

import Avatar from "./Avatar";
import { CountUp, Medal, useFlip } from "./Motion";
import { Hatted } from "./PodiumHats";


export type RaceRow = {
  key: string;
  name: string;
  imageUrl?: string;
  count: number;
  rank: number;
  isYou: boolean;
  /** Their own clock is running (a quality competition). */
  live?: boolean;
  /** Small chips after the name: First find, On fire, an earned title. */
  badges?: React.ReactNode;
  /** Places climbed, shown as a green arrow for a while. */
  moved?: number;
};

/** Step heights by place: the stagger IS the podium. */
const HEIGHTS: Record<number, number> = { 1: 104, 2: 78, 3: 58 };
/** Each step's tint: gold, silver, bronze. */
const TINT: Record<number, string> = {
  1: "linear-gradient(180deg, #fde3c8 0%, #fbeee2 100%)",
  2: "linear-gradient(180deg, #eceef2 0%, #f5f5f3 100%)",
  3: "linear-gradient(180deg, #f6e1cf 0%, #f8efe6 100%)",
};

/**
 * The board every competition in Brief uses: the Quality competition on the
 * Tickets page, a quality competition as it runs, and a quality competition once it is over. The
 * first three stand on a podium (2nd, 1st, 3rd, the leader in the middle),
 * hats on, on steps tinted gold, silver and bronze that rise in drumroll order
 * while their numbers count up; the leader may say something in a bubble.
 * Under each name: their badges (an earned title, First find, On fire), and a
 * green arrow over whoever just climbed. Everyone else is a compact row with a
 * bar against the leader's count, in a box of about seven rows that scrolls;
 * your row is marked and rows slide when the order changes. Before anyone has a count there is no race to draw: everyone
 * is a row.
 */
export default function PodiumBoard({ rows, quip }: { rows: RaceRow[]; quip?: string }) {
  const racing = rows.some((r) => r.count > 0);
  const top = racing ? rows.slice(0, 3) : [];
  const rest = racing ? rows.slice(3) : rows;
  const order = top.length >= 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
  const lead = Math.max(1, ...rows.map((r) => r.count));
  const box = useFlip<HTMLOListElement>([rest.map((r) => r.key).join("|")]);

  return (
    <div>
      {racing && (
        <ol
          className={`podium mx-auto grid items-end gap-2 ${
            order.length >= 3 ? "max-w-[620px] grid-cols-[repeat(3,minmax(0,1fr))]" : order.length === 2 ? "max-w-[420px] grid-cols-[repeat(2,minmax(0,1fr))]" : "max-w-[210px] grid-cols-1"
          }`}
        >
          {order.map((r) => {
            const place = top.indexOf(r) + 1;
            // 3rd rises first, then 2nd, then the leader: drumroll order
            const step = place === 1 ? 2 : place === 2 ? 1 : 0;
            return (
              <li key={r.key} data-place={place} className="relative flex min-w-0 flex-col items-center text-center">
                {place === 1 && quip && (
                  <div className="podium-brag relative z-10 mb-2 flex flex-col items-center" style={{ animationDelay: "900ms" }}>
                    <p className="w-max max-w-[17rem] rounded-full bg-[rgba(221,105,54,.09)] px-3 py-1 text-xs leading-relaxed text-accent">“{quip}”</p>
                    <span aria-hidden className="h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-[rgba(221,105,54,.09)]" />
                  </div>
                )}
                <div className="animate-rise relative isolate flex flex-col items-center" style={{ animationDelay: `${260 + step * 140}ms` }}>
                  {!!r.moved && (
                    <span className="race-up absolute -right-6 top-1/2 z-10" title={`Up ${r.moved}`}>
                      ▲{r.moved}
                    </span>
                  )}
                  <Hatted rank={place}>
                    <span className={`relative inline-flex rounded-full ${r.isYou ? "ring-2 ring-[rgba(221,105,54,.45)] ring-offset-2 ring-offset-surface" : ""}`}>
                      <Avatar name={r.name} imageUrl={r.imageUrl} size={place === 1 ? 52 : 42} />
                      {r.live && <span title="Testing now" className="dot-pulse absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface bg-accent" />}
                    </span>
                  </Hatted>
                </div>
                <p className="mt-2 w-full truncate text-[13.5px] font-medium text-ink">
                  {r.name}
                  {r.isYou && <span className="ml-1 text-[11px] text-accent">you</span>}
                </p>
                <div className="mt-1 flex h-[18px] max-w-full items-center justify-center gap-1 overflow-hidden">{r.badges}</div>
                <div
                  className={`podium-block podium-step relative mt-3 flex w-full flex-col items-center justify-start gap-1.5 rounded-t-[12px] pt-3 ${place === 1 ? "podium-step-lead" : ""}`}
                  style={{ height: HEIGHTS[place], background: TINT[place], animationDelay: `${step * 140}ms` }}
                >
                  <Medal rank={place} size={18} />
                  <CountUp value={r.count} fromZero className={`font-semibold leading-none tracking-[-0.03em] ${place === 1 ? "text-[28px] text-accent" : "text-[22px] text-ink-2"}`} />
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {rest.length > 0 && (
        <ol
          ref={box}
          className={`thin-scroll mx-auto flex max-h-[320px] max-w-[620px] flex-col gap-1 overflow-y-auto overscroll-contain ${racing ? "border-t border-hairline pt-2" : ""}`}
        >
          {rest.map((r) => (
            <li
              key={r.key}
              data-flip={r.key}
              className={`race-row flex min-h-10 items-center gap-2.5 rounded-[10px] px-2 py-1 ${r.isYou ? "bg-[rgba(221,105,54,.07)]" : "hover:bg-surface-2"}`}
            >
              <span className="w-5 shrink-0 text-center text-xs tabular-nums text-faint">{racing ? r.rank : ""}</span>
              <span className="relative inline-flex shrink-0">
                <Avatar name={r.name} imageUrl={r.imageUrl} size={24} />
                {r.live && <span title="Testing now" className="dot-pulse absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-accent" />}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="truncate text-[13px] text-ink">{r.name}</span>
                {r.isYou && <span className="text-[11px] font-medium text-accent">you</span>}
                {r.badges}
                {!!r.moved && (
                  <span className="race-up" title={`Up ${r.moved}`}>
                    ▲{r.moved}
                  </span>
                )}
              </span>
              {racing && (
                <span className="hidden h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-[rgba(26,22,18,.07)] sm:block" aria-hidden="true">
                  <span className={`race-bar block h-full rounded-full ${r.isYou ? "bg-accent/70" : "bg-[rgba(26,22,18,.24)]"}`} style={{ width: `${Math.max(r.count ? 8 : 0, (r.count / lead) * 100)}%` }} />
                </span>
              )}
              {racing && <CountUp value={r.count} fromZero className="w-7 shrink-0 text-right text-[14px] font-semibold text-ink-2" />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
