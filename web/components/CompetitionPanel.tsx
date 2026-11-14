"use client";

import { useState } from "react";
import type { PodiumEntry } from "@/lib/org-server";
import Avatar from "./Avatar";
import Podium from "./Podium";
import { Hatted } from "./PodiumHats";
import { copyInviteLink } from "./DashboardFun";
import { CountUp, Medal } from "./Motion";

/**
 * The Quality competition, as one line over the tickets. Closed, it shows the
 * three on the podium (hats on) and where you stand: your rank this month and
 * how many more to pass whoever is ahead. "Ranking" opens the whole board in
 * place, so there is no page to go to. Alone, the open places are seats and
 * the line invites the team.
 */
export default function CompetitionPanel({
  month,
  all,
  orgName,
  quipSeed,
}: {
  month: PodiumEntry[];
  all: PodiumEntry[];
  /** The team's name, when there is a team. */
  orgName: string | null;
  /** Picks the leader's line, fresh per page load. */
  quipSeed?: number;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const alone = all.length <= 1;
  const me = month.find((e) => e.isYou);
  const ahead = me ? month.find((e) => e.rank === me.rank - 1) : undefined;
  const invite = async () => {
    if (await copyInviteLink()) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <section aria-label="Quality competition" className="overflow-hidden rounded-[14px] border border-hairline bg-[linear-gradient(90deg,#fdeee2_0%,var(--color-surface)_62%)]">
      <div className="flex items-center gap-4 py-2.5 pl-4 pr-3">
        <span className="flex shrink-0 items-end pt-3" aria-hidden="true">
          {month.slice(0, 3).map((e) => (
            <span key={e.userId} className="ml-1.5 first:ml-0">
              <Hatted rank={e.rank}>
                <Avatar name={e.name} imageUrl={e.imageUrl} size={30} />
              </Hatted>
            </span>
          ))}
          {alone &&
            [0, 1].map((i) => (
              <span
                key={i}
                className="invite-seat ml-1.5 grid h-[30px] w-[30px] place-items-center rounded-full border-[1.5px] border-dashed border-[rgba(26,22,18,.22)] bg-surface text-sm text-muted"
                style={{ animationDelay: `${i * 0.25}s` }}
              >
                +
              </span>
            ))}
        </span>
        <p className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium text-ink sm:truncate">
            {alone ? (
              "Just you so far"
            ) : me ? (
              <span className="inline-flex items-center gap-1.5">
                <Medal rank={me.rank} size={18} />
                You are <span className="text-accent">#{me.rank}</span> this month
                <span className="text-muted">·</span>
                <span className="text-ink-2">
                  <CountUp value={me.filed} fromZero /> {me.filed === 1 ? "bug" : "bugs"}
                </span>
              </span>
            ) : (
              "Quality competition"
            )}
          </span>
          <span className="block text-[13px] text-muted sm:truncate">
            {alone ? "Brief is free for your whole team" : ahead ? `${ahead.filed - (me?.filed ?? 0) + 1} more to pass ${ahead.name.split(" ")[0]}` : me?.rank === 1 ? "You lead the team" : (orgName ?? "Your team")}
          </span>
          {/* how close you are to whoever is just ahead */}
          {!alone && me && ahead && ahead.filed > 0 && (
            <span className="mt-1.5 block h-1 max-w-[220px] overflow-hidden rounded-full bg-[rgba(26,22,18,.08)]" aria-hidden="true">
              <span className="lead-bar block h-full rounded-full bg-[linear-gradient(90deg,#f08350,#dd6936)]" style={{ width: `${Math.max(6, (me.filed / (ahead.filed + 1)) * 100)}%` }} />
            </span>
          )}
        </p>
        {alone ? (
          <button type="button" onClick={invite} className="btn h-[30px]">
            {copied ? "Link copied" : "Invite"}
          </button>
        ) : (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="btn-ghost h-[30px] gap-1.5 px-2.5">
            {open ? "Hide ranking" : "Ranking"}
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
              <path d="M4 6.2 8 10.2 12 6.2" />
            </svg>
          </button>
        )}
      </div>
      {/* It grows open: the grid row goes from nothing to its content's height. */}
      <div className={`grid transition-[grid-template-rows] duration-300 ease-[var(--ease-out)] ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="min-h-0 overflow-hidden" inert={!open}>
          <div className="border-t border-[rgba(221,105,54,.14)] bg-surface/70 px-6 pb-5 pt-5">
            <Podium month={month} all={all} orgName={orgName ?? "Your team"} quipSeed={quipSeed} active={open} />
          </div>
        </div>
      </div>
    </section>
  );
}
