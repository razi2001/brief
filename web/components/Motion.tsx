"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * A number that counts to its value instead of jumping: from 0 on its first
 * paint when `fromZero`, and from the old value whenever it changes, with a
 * small pop at the end so a change is seen. None with reduced motion.
 */
export function CountUp({ value, fromZero = false, className = "" }: { value: number; fromZero?: boolean; className?: string }) {
  const [shown, setShown] = useState(fromZero ? 0 : value);
  const [pop, setPop] = useState(0);
  const from = useRef(fromZero ? 0 : value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value) return;
    let raf = 0;
    const t0 = performance.now();
    // with reduced motion it lands on the first frame
    const dur = reduced() ? 1 : Math.min(900, 380 + Math.abs(value - start) * 40);
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(start + (value - start) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
      else setPop((p) => p + 1);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <span key={pop} className={`inline-block tabular-nums ${pop ? "count-pop" : ""} ${className}`}>
      {shown}
    </span>
  );
}

/**
 * Children that keep their place by key slide to their new place when the
 * order changes (FLIP), instead of jumping: a leaderboard reordering itself.
 * Give each child a `data-flip` attribute with a stable key.
 */
export function useFlip<T extends HTMLElement>(deps: unknown[]) {
  const box = useRef<T>(null);
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    const seen = new Map<string, number>();
    root.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const key = el.dataset.flip!;
      const top = el.getBoundingClientRect().top;
      seen.set(key, top);
      const before = last.current.get(key);
      if (before !== undefined && Math.abs(before - top) > 1 && !reduced()) {
        el.animate([{ transform: `translateY(${before - top}px)` }, { transform: "none" }], { duration: 520, easing: "cubic-bezier(.23,1,.32,1)" });
      }
    });
    last.current = seen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return box;
}

/** A pseudo-random number in [0,1) from a seed: the same pieces every render. */
const rand = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const COLORS = ["#dd6936", "#e9b949", "#5e9b6a", "#3d74cc", "#6f52c9", "#f08350"];

/**
 * A short burst of confetti over the page, once: for a winner. Gone after
 * two and a half seconds; never with reduced motion.
 */
export function Confetti({ pieces = 70 }: { pieces?: number }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setOn(false), 2600);
    return () => clearTimeout(t);
  }, []);
  if (!on || reduced()) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {Array.from({ length: pieces }, (_, i) => {
        const left = rand(i) * 100;
        const delay = rand(i + 100) * 400;
        const dur = 1500 + rand(i + 200) * 900;
        const drift = (rand(i + 300) - 0.5) * 160;
        const spin = (rand(i + 400) - 0.5) * 1080;
        const w = 6 + rand(i + 500) * 6;
        return (
          <span
            key={i}
            className="confetti-piece"
            style={
              {
                left: `${left}%`,
                width: w,
                height: w * (rand(i + 600) > 0.5 ? 0.45 : 1),
                background: COLORS[i % COLORS.length],
                borderRadius: rand(i + 700) > 0.7 ? "50%" : 2,
                animationDelay: `${delay}ms`,
                animationDuration: `${dur}ms`,
                "--drift": `${drift}px`,
                "--spin": `${spin}deg`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

/** A medal for the first three places, the place number for the rest. */
export function Medal({ rank, size = 22 }: { rank: number; size?: number }) {
  const tone = rank === 1 ? ["#f6d77a", "#c9962a"] : rank === 2 ? ["#e3e6eb", "#9aa1ab"] : rank === 3 ? ["#f0c09a", "#b97a4b"] : null;
  if (rank < 1) return <span className="shrink-0" style={{ width: size, height: size }} aria-hidden />;
  if (!tone)
    return (
      <span className="grid shrink-0 place-items-center text-xs tabular-nums text-faint" style={{ width: size, height: size }}>
        {rank}
      </span>
    );
  return (
    <span
      className="relative grid shrink-0 place-items-center rounded-full text-[11px] font-bold tabular-nums text-white shadow-[inset_0_-1px_0_rgba(0,0,0,.12),0_1px_2px_rgba(26,22,18,.15)]"
      style={{ width: size, height: size, background: `linear-gradient(160deg, ${tone[0]}, ${tone[1]})` }}
      title={["", "First", "Second", "Third"][rank]}
    >
      {rank}
    </span>
  );
}
