"use client";

import Link from "next/link";
import { useState } from "react";
import BrandMark from "@/components/BrandMark";
import { CHROME_STORE_URL } from "@/lib/chrome-store";
import { GROUPS, LESSONS, lessonNumber, type Lesson } from "@/lib/guide/lessons";
import { countDone, isDone } from "@/lib/guide/progress";
import { SCENES } from "./scenes";
import { SceneFrame, useReducedMotion } from "./ScenePlayer";
import { useGuideProgress } from "./useGuideProgress";
import { useGuideFacts } from "./GuideFacts";
import { useScene } from "./useScene";

const tick = (
  <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 6.2 5 8.5l4.5-5" />
  </svg>
);

/** A lesson card: its number, its picture (playing while hovered), title and line. */
function LessonCard({ lesson, done, next }: { lesson: Lesson; done: boolean; next: boolean }) {
  const def = SCENES[lesson.scene];
  const [hover, setHover] = useState(false);
  const reduced = useReducedMotion();
  const { index } = useScene(def.frames, { playing: hover && !reduced, start: def.poster });
  const n = lessonNumber(lesson.slug);
  return (
    <Link
      href={`/guide/${lesson.slug}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className={`card group relative flex flex-col overflow-hidden no-underline hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(26,22,18,.04),0_14px_30px_-18px_rgba(26,22,18,.35)] ${
        next ? "ring-2 ring-accent/70 ring-offset-2 ring-offset-cream" : ""
      }`}
    >
      <div className="relative border-b hairline">
        <SceneFrame def={def} index={index} still={!hover} />
        {next && (
          <span className="absolute right-2.5 top-2.5 rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-white shadow-[0_2px_8px_rgba(221,105,54,.35)]">
            {n === 1 ? "Start here" : "Next"}
          </span>
        )}
      </div>
      <div className="flex flex-1 items-start gap-3 px-4 py-3">
        <span
          className={`mt-[1px] flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums ${
            done ? "bg-[#2f7d4f] text-white" : next ? "bg-accent text-white" : "bg-[rgba(26,22,18,.06)] text-muted"
          }`}
          aria-label={done ? `Lesson ${n}, done` : `Lesson ${n}`}
        >
          {done ? tick : n}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] font-semibold text-ink">{lesson.title}</span>
          <span className="text-[13px] leading-snug text-muted">{lesson.blurb}</span>
        </span>
      </div>
    </Link>
  );
}

/** The Guide: a numbered path from installing Brief to its extras. */
export default function GuideHub() {
  const facts = useGuideFacts();
  const { tried } = useGuideProgress();
  const done = countDone(LESSONS, facts, tried);
  const next = LESSONS.find((l) => !isDone(l, facts, tried));

  return (
    <div className="mx-auto w-full max-w-[1000px]">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">Guide</h1>
          <p className="mt-1 text-[15px] text-ink-2">
            From install to your first ticket, then the <em className="font-display text-[1.15em] text-accent">extras</em>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-40">
            <div className="text-[12px] text-muted">
              {done} of {LESSONS.length} done
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[rgba(26,22,18,.08)]">
              <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(done / LESSONS.length) * 100}%` }} />
            </div>
          </div>
          {next && (
            <Link href={`/guide/${next.slug}`} className="btn-accent">
              {done ? "Continue" : "Start"}
            </Link>
          )}
        </div>
      </header>

      {facts.extension === false && (
        <section className="card mt-7 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <BrandMark size={36} className="shrink-0" />
          <div className="flex-1 text-[15px] font-semibold text-ink">Brief Cloud for Chrome</div>
          <a href={CHROME_STORE_URL} target="_blank" rel="noopener" className="btn-accent justify-center">
            Add to Chrome
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M5 11 11 5M6 5h5v5" />
            </svg>
          </a>
        </section>
      )}

      {GROUPS.map((g) => {
        const lessons = LESSONS.filter((l) => l.group === g.key);
        return (
          <section key={g.key} className="mt-10" aria-labelledby={`g-${g.key}`}>
            <h2 id={`g-${g.key}`} className="mb-4 px-0.5 text-[18px] font-semibold tracking-[-0.01em] text-ink">
              {g.title}
            </h2>
            <div className={`grid gap-4 sm:grid-cols-2 ${lessons.length > 2 ? "lg:grid-cols-3" : ""}`}>
              {lessons.map((l) => (
                <LessonCard key={l.slug} lesson={l} done={isDone(l, facts, tried)} next={next?.slug === l.slug} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
