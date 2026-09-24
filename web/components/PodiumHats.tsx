"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { pupilOffset } from "@/lib/googly";

/**
 * Headwear for the podium: a googly-eyed crown for first place, a party hat for
 * second, a paper crown for third. Everyone past third gets a plain list row.
 *
 * Purely decorative: every hat is aria-hidden and nothing depends on it. Motion
 * respects prefers-reduced-motion - the hats stop bobbing (globals.css) and the
 * crown stops blinking and looking around (below).
 */

/** Pupil radius, and how far it may travel from the centre of its eye (SVG units). */
const PUPIL_R = 2.4;
const PUPIL_TRAVEL = 2.4;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function GooglyCrown() {
  const whites = useRef<Array<SVGCircleElement | null>>([]);
  const pupils = useRef<Array<SVGCircleElement | null>>([]);
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    // One read per animation frame, however fast the pointer moves.
    let frame = 0;
    let pointer: { x: number; y: number } | null = null;
    const look = () => {
      frame = 0;
      const p = pointer;
      if (!p) return;
      whites.current.forEach((white, i) => {
        const pupil = pupils.current[i];
        if (!white || !pupil) return;
        const r = white.getBoundingClientRect();
        const { dx, dy } = pupilOffset(
          { x: r.left + r.width / 2, y: r.top + r.height / 2 },
          p,
          PUPIL_TRAVEL,
        );
        pupil.setAttribute("transform", `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
      });
    };
    const onMove = (e: MouseEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(look);
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    // Irregular on purpose: a blink on a metronome reads as a screensaver.
    let shut: ReturnType<typeof setTimeout> | undefined;
    let open: ReturnType<typeof setTimeout> | undefined;
    const scheduleBlink = () => {
      shut = setTimeout(() => {
        setBlink(true);
        open = setTimeout(() => {
          setBlink(false);
          scheduleBlink();
        }, 140);
      }, 2500 + Math.random() * 3500);
    };
    scheduleBlink();

    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(shut);
      clearTimeout(open);
    };
  }, []);

  return (
    <svg
      data-hat="crown"
      width={48}
      height={32}
      viewBox="-3 0 46 31"
      className="block origin-bottom -rotate-6"
      aria-hidden
    >
      <path
        d="M4 29 L2 8 L12 15 L20 3 L28 15 L38 8 L36 29 Z"
        fill="#EF9F27"
        stroke="#854F0B"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <circle cx={2} cy={8} r={2.8} fill="#dd6936" />
      <circle cx={20} cy={3} r={2.8} fill="#dd6936" />
      <circle cx={38} cy={8} r={2.8} fill="#dd6936" />
      {[13.5, 26.5].map((cx, i) => (
        <g key={cx} className="googly-eye" data-blink={blink}>
          <circle
            ref={(el) => {
              whites.current[i] = el;
            }}
            cx={cx}
            cy={21}
            r={5}
            fill="#fffdf8"
            stroke="#854F0B"
            strokeWidth={1}
          />
          <circle
            ref={(el) => {
              pupils.current[i] = el;
            }}
            className="googly-pupil"
            cx={cx}
            cy={21}
            r={PUPIL_R}
            fill="#1a1612"
          />
        </g>
      ))}
    </svg>
  );
}

export function PartyHat() {
  return (
    <svg
      data-hat="party"
      width={22}
      height={25}
      viewBox="0 0 26 30"
      className="hat-bob block"
      style={{ "--hat-tilt": "-10deg", animationDelay: "-0.4s" } as CSSProperties}
      aria-hidden
    >
      <path
        d="M3 29 L13 4 L23 29 Z"
        fill="#AFA9EC"
        stroke="#534AB7"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <path d="M6.5 21 L19.5 21" stroke="#fffdf8" strokeWidth={2} />
      <path d="M9.5 13.5 L16.5 13.5" stroke="#fffdf8" strokeWidth={2} />
      <circle cx={13} cy={4} r={3.2} fill="#dd6936" />
    </svg>
  );
}

export function PaperCrown() {
  return (
    <svg
      data-hat="paper"
      width={30}
      height={16}
      viewBox="0 0 34 18"
      className="hat-bob block"
      style={{ "--hat-tilt": "8deg", animationDelay: "-1.1s" } as CSSProperties}
      aria-hidden
    >
      <path
        d="M1 17 L1 5 L7 11 L12 3 L17 11 L22 3 L27 11 L33 5 L33 17 Z"
        fill="#fffdf8"
        stroke="#8a8378"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

type PodiumRank = 1 | 2 | 3;

function isPodiumRank(rank: number): rank is PodiumRank {
  return rank === 1 || rank === 2 || rank === 3;
}

/** Each hat's height (px), and how far it sits down over the head. */
const FIT: Record<PodiumRank, { height: number; overlap: number }> = {
  1: { height: 32, overlap: 12 },
  2: { height: 25, overlap: 8 },
  3: { height: 16, overlap: 6 },
};

/**
 * An avatar wearing the hat its podium place earns, or just the avatar.
 *
 * The wrapper reserves the room the hat rises above the head, so a hat never
 * climbs into the leader's speech bubble.
 */
export function Hatted({ rank, children }: { rank: number; children: ReactNode }) {
  if (!isPodiumRank(rank)) return <>{children}</>;
  const { height, overlap } = FIT[rank];
  return (
    <span className="relative inline-flex" style={{ marginTop: height - overlap }}>
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 -translate-x-1/2"
        style={{ bottom: `calc(100% - ${overlap}px)` }}
      >
        {rank === 1 ? <GooglyCrown /> : rank === 2 ? <PartyHat /> : <PaperCrown />}
      </span>
    </span>
  );
}
