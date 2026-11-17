"use client";

import { useEffect, useState } from "react";

/**
 * The big button that starts your own clock in a quality competition: an
 * arcade button with a stopwatch on it. It nudges now and then, the hand runs
 * faster under the pointer, and a press sinks it. The Guide draws it too, with
 * `pressed` standing in for the click.
 */
export default function StartButton({
  label,
  onStart,
  disabled = false,
  pressed = false,
}: {
  label: string;
  onStart?: () => void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button type="button" onClick={onStart} disabled={disabled} data-pressed={pressed || undefined} className="go-btn">
      <span className="go-face" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 2.5h4M12 2.5v2.4M18.6 6.2l1.3-1.3" stroke="#b24a1d" strokeWidth="1.9" />
          <circle cx="12" cy="13.2" r="7.6" fill="#fff4ec" stroke="#dd6936" strokeWidth="1.9" />
          <path d="M12 7.4v1.1M17.8 13.2h-1.1M12 19v-1.1M6.2 13.2h1.1" stroke="#f0a77f" strokeWidth="1.5" />
          <g className="go-hand">
            <path d="M12 13.2V8.6" stroke="#1a1612" strokeWidth="2" />
          </g>
          <circle cx="12" cy="13.2" r="1.3" fill="#1a1612" />
        </svg>
      </span>
      <span className="go-label">{label}</span>
      <span className="go-tag" aria-hidden="true">
        GO
      </span>
    </button>
  );
}

/**
 * 3, 2, 1, GO! over the arena, once, after a press. `run` changes to start it
 * again; null shows nothing. Skipped for anyone who asked for less motion.
 */
export function Countdown({ run }: { run: number | null }) {
  const [step, setStep] = useState<{ run: number; n: number } | null>(null);
  // A new press starts it from 3.
  const [seen, setSeen] = useState<number | null>(run);
  if (run !== seen) {
    setSeen(run);
    const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setStep(run !== null && !still ? { run, n: 3 } : null);
  }
  useEffect(() => {
    if (!step) return;
    const t = setTimeout(() => setStep(step.n > 0 ? { run: step.run, n: step.n - 1 } : null), step.n > 0 ? 620 : 750);
    return () => clearTimeout(t);
  }, [step]);
  if (!step) return null;
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[inherit] bg-[rgba(255,252,248,.82)] backdrop-blur-[2px]">
      <span key={`${step.run}-${step.n}`} className={`go-count ${step.n === 0 ? "go-count-go" : ""}`}>
        {step.n === 0 ? "GO!" : step.n}
      </span>
    </span>
  );
}
