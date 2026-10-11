"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/** The dashboard's moving parts: the counter, bugs landing on a cloud, time saved, the proof ring. */

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;
// rounded: the server and the browser print long floats differently
const round = (v: number) => Math.round(v * 100) / 100;

/** Seeded so the server and the browser draw the same thing. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number that counts up from 0 when the page opens. */
export function CountUp({ to, ms = 1500, delay = 0 }: { to: number; ms?: number; delay?: number }) {
  const [v, setV] = useState(to);
  useIso(() => {
    if (reduced() || to === 0) return;
    setV(0);
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      setV(Math.round(to * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms, delay]);
  return <>{v.toLocaleString()}</>;
}

const MAX_BUGS = 70;
const SCENE_H = 112; // px
const VB_H = 120; // the cloud surface's viewBox height
const BASE = 56; // surface valley line, in viewBox units

/**
 * The cloud surface along the bottom: a row of soft bumps. Each bump is one
 * quadratic curve whose control point sits midway, so x is linear in t and the
 * surface height at any x is exact - that's what lets every bug sit ON it.
 */
function surface(seed: number) {
  const r = rng(seed * 31 + 5);
  const segs: Array<{ x0: number; dx: number; h: number }> = [];
  let x = 0;
  while (x < 100) {
    const dx = 6 + r() * 5; // percent of the width
    segs.push({ x0: x, dx, h: 9 + r() * 9 });
    x += dx;
  }
  const yAt = (xp: number) => {
    const s = segs.find((g) => xp >= g.x0 && xp <= g.x0 + g.dx) ?? segs[segs.length - 1];
    const t = Math.min(1, Math.max(0, (xp - s.x0) / s.dx));
    return BASE - 4 * s.h * t * (1 - t);
  };
  const d =
    `M0 ${BASE} ` +
    segs.map((g) => `q ${round(g.dx * 5)} ${round(-2 * g.h)} ${round(g.dx * 10)} 0`).join(" ") +
    ` V ${VB_H} H 0 Z`;
  return { d, yAt };
}

/**
 * Every bug caught, dropped out of the sky onto a bank of cloud, each one
 * landing exactly on the surface (a few pile onto their neighbours). Past
 * MAX_BUGS one bug stands for several tickets. Hover one and it hops; now and
 * then one hops on its own.
 */
export function BugCloud({ count, seed = 7 }: { count: number; seed?: number }) {
  const per = Math.max(1, Math.ceil(count / MAX_BUGS));
  const n = Math.ceil(count / per);
  const { d, yAt } = useMemo(() => surface(seed), [seed]);
  const bugs = useMemo(() => {
    const r = rng(seed);
    const placed: Array<{ x: number; b: number }> = [];
    return Array.from({ length: n }, (_, i) => {
      // bottom offset (px) of the surface under x, sunk a little into the fluff
      const ground = (xp: number) => SCENE_H - (yAt(xp) / VB_H) * SCENE_H - 5;
      let x = round(3 + r() * 94);
      let b = ground(x);
      // a bug landing on another one climbs on top of it - two high at most,
      // past that it looks for a free spot (the pile must stay off the text)
      for (let tries = 0; tries < 6; tries++) {
        const g = ground(x);
        b = g;
        for (const q of placed) if (Math.abs(q.x - x) < 1.6 && q.b + 11 > b) b = q.b + 11;
        if (b <= g + 11) break;
        x = round(3 + r() * 94);
      }
      placed.push({ x, b });
      return {
        x,
        b: round(b),
        rot: Math.round((r() - 0.5) * 120),
        delay: Math.round(i * (1100 / Math.max(n, 1)) + r() * 140),
        dark: r() < 0.2,
      };
    });
  }, [n, seed, yAt]);

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reduced() || n === 0) return;
    const id = setInterval(() => {
      const els = ref.current?.querySelectorAll<HTMLElement>("[data-bug]");
      if (!els?.length) return;
      hop(els[Math.floor(Math.random() * els.length)]);
    }, 1500);
    return () => clearInterval(id);
  }, [n]);

  return (
    <div ref={ref} className="pointer-events-none relative w-full" style={{ height: SCENE_H }} aria-hidden="true">
      {bugs.map((g, i) => (
        <span key={i} className="bug-fall absolute" style={{ left: `${g.x}%`, bottom: g.b, animationDelay: `${g.delay}ms` }}>
          <span
            data-bug
            className="bug pointer-events-auto block"
            style={{ ["--rot" as string]: `${g.rot}deg` }}
            onMouseEnter={(e) => hop(e.currentTarget)}
          >
            <Bug dark={g.dark} />
          </span>
        </span>
      ))}
      {/* the surface is drawn over the bugs' feet so they sit IN the cloud */}
      <svg viewBox={`0 0 1000 ${VB_H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full drop-shadow-[0_-4px_10px_rgba(170,130,90,0.14)]">
        <defs>
          <linearGradient id="bankFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.3" stopColor="#ffffff" />
            <stop offset="1" stopColor="#fbf6ee" />
          </linearGradient>
        </defs>
        <path d={d} fill="url(#bankFill)" stroke="rgba(170,130,90,0.16)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function hop(el: HTMLElement) {
  el.classList.remove("bug-hop");
  void el.offsetWidth;
  el.classList.add("bug-hop");
}

function Bug({ dark }: { dark: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" className="-translate-x-1/2">
      <g stroke="#3a3530" strokeWidth="1.3" strokeLinecap="round" opacity=".7">
        <path d="M7 10 3.5 8M6.6 13.5H3M7 17l-3.5 2M17 10l3.5-2M17.4 13.5H21M17 17l3.5 2M10.5 5.5 9 3M13.5 5.5 15 3" />
      </g>
      <circle cx="12" cy="7" r="2.6" fill="#3a3530" />
      <ellipse cx="12" cy="14" rx="5.6" ry="6.6" fill={dark ? "#5e554b" : "#dd6936"} />
      <path d="M12 7.6v13" stroke="#3a3530" strokeWidth="1" opacity=".45" />
      <circle cx="9.6" cy="12.6" r="1.1" fill="#3a3530" opacity=".45" />
      <circle cx="14.6" cy="15.6" r="1.1" fill="#3a3530" opacity=".45" />
    </svg>
  );
}

const MILESTONES: Array<[number, string]> = [
  [8, "a workday"],
  [40, "a work week"],
  [160, "a work month"],
  [480, "a quarter"],
  [1920, "a year"],
];

/** Hours saved, filling up toward the next milestone. */
export function TimeBar({ hours, compact = false }: { hours: number; compact?: boolean }) {
  const [next, label] = MILESTONES.find(([h]) => h > hours) ?? MILESTONES[MILESTONES.length - 1];
  const lit = Math.round(Math.min(1, hours / next) * 20);
  if (compact) {
    // one slim bar, its basis in the tooltip of the row it sits in
    return (
      <span className="block h-1.5 overflow-hidden rounded-full bg-cream-2" aria-hidden="true">
        <span className="reactor-on block h-full rounded-full" style={{ width: `${(lit / 20) * 100}%` }} />
      </span>
    );
  }
  return (
    <div>
      <div className="flex gap-[3px]" aria-hidden="true">
        {Array.from({ length: 20 }, (_, i) => (
          <span
            key={i}
            className={`h-2 flex-1 rounded-full ${i < lit ? "reactor-on" : "bg-cream-2"}`}
            style={{ animationDelay: `${400 + i * 55}ms` }}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        {hours} of {next}h to {label} back
      </p>
    </div>
  );
}

/** A ring that fills to the share of tickets that came with proof. */
export function ProofRing({ share, size = 64 }: { share: number; size?: number }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOn(true), 400);
    return () => clearTimeout(t);
  }, []);
  const c = 2 * Math.PI * 26;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className="-rotate-90" aria-hidden="true">
      <circle cx="32" cy="32" r="26" fill="none" stroke="var(--color-cream-2)" strokeWidth={size < 32 ? 10 : 6} />
      <circle
        cx="32"
        cy="32"
        r="26"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={size < 32 ? 10 : 6}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={on ? c * (1 - share) : c}
        style={{ transition: "stroke-dashoffset 1.4s cubic-bezier(.22,1,.36,1)" }}
      />
    </svg>
  );
}

/** Plain sign-up: teammates on the same tracker workspace join your board by themselves. */
const inviteLink = () => `${window.location.origin}/sign-up`;

/** Copies the invite link; false when the clipboard is blocked. */
export async function copyInviteLink(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(inviteLink());
    return true;
  } catch {
    return false;
  }
}

/**
 * Shown while you're the only one here: Brief is free, so the nudge is to
 * bring the team. The link is plain sign-up - teammates who connect the same
 * tracker workspace land on your leaderboard by themselves.
 */
export function InviteCard({ orgName }: { orgName?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyInviteLink()) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };
  const mail = () => {
    const body = `I catch bugs with Brief: talk through a bug and it writes the ticket for you. It's free, join me: ${inviteLink()}`;
    window.location.href = `mailto:?subject=${encodeURIComponent("Join me on Brief")}&body=${encodeURIComponent(body)}`;
  };
  return (
    <section className="card mt-4 flex flex-col gap-5 overflow-hidden px-6 py-5 sm:flex-row sm:items-center">
      {/* you, and the empty seats next to you */}
      <div className="flex shrink-0 items-center" aria-hidden="true">
        <span className="z-10 grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-[#f08a5a] to-accent text-white shadow-[0_0_0_3px_#fffdfa]">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m5 12 5 5 9-10" /></svg>
        </span>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="invite-seat -ml-2.5 grid h-11 w-11 place-items-center rounded-full border-[1.5px] border-dashed border-[rgba(26,22,18,.22)] bg-surface text-lg text-muted shadow-[0_0_0_3px_#fffdfa]"
            style={{ animationDelay: `${i * 0.25}s` }}
          >
            +
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-ink">Invite your team{orgName ? ` at ${orgName}` : ""}</p>
        <p className="mt-0.5 text-[13px] text-muted">Brief is free for everyone. Catch bugs together, race for the crown.</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={mail} className="btn">
          Email
        </button>
        <button type="button" onClick={copy} className="btn-accent">
          {copied ? "Link copied" : "Copy invite link"}
        </button>
      </div>
    </section>
  );
}
