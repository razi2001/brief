"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { GROUPS, LESSONS, lessonBySlug, lessonNumber, neighbours } from "@/lib/guide/lessons";
import { isDone } from "@/lib/guide/progress";
import { SCENES } from "./scenes";
import { SceneFrame, useInView, useReducedMotion } from "./ScenePlayer";
import StepText from "./StepText";
import TryIt, { DoneToggle, LessonAction } from "./TryIt";
import { useGuideProgress } from "./useGuideProgress";
import { useGuideFacts } from "./GuideFacts";
import { useScene } from "./useScene";

/**
 * A lesson: the illustration beside its steps (the step on screen is lit;
 * click a step to see it), what to do next under them, the sandbox when there
 * is one, then the next lesson.
 */
export default function LessonView({ slug }: { slug: string }) {
  const facts = useGuideFacts();
  const lesson = lessonBySlug(slug)!;
  const def = SCENES[lesson.scene];
  const { prev, next } = neighbours(slug);
  const { tried, markTried } = useGuideProgress();
  const done = isDone(lesson, facts, tried);

  const stageRef = useRef<HTMLDivElement>(null);
  const inView = useInView(stageRef);
  const reduced = useReducedMotion();
  const { frame, index, jumpToStep } = useScene(def.frames, { playing: inView && !reduced });

  // reduced motion: hold each step on its finished picture
  useEffect(() => {
    if (reduced) jumpToStep(0, "last");
  }, [reduced, jumpToStep]);

  const group = GROUPS.find((g) => g.key === lesson.group)?.title;

  return (
    <div className="w-full">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-muted">
        <Link href="/guide" className="no-underline hover:text-ink">
          How to use Brief
        </Link>
        <span aria-hidden="true">›</span>
        <span>{group}</span>
        <span className="text-muted/70">
          · {lessonNumber(slug)} of {LESSONS.length}
        </span>
      </nav>
      <header className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div>
          <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.015em] text-ink">{lesson.title}</h1>
          <p className="mt-1.5 max-w-[60ch] text-[15px] leading-relaxed text-ink-2">{lesson.blurb}</p>
        </div>
        <div className="shrink-0 sm:pt-1">
          <DoneToggle done={done} onDone={() => markTried(lesson.slug)} />
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div ref={stageRef} className="overflow-hidden rounded-[16px] border hairline shadow-[0_1px_2px_rgba(26,22,18,.04),0_18px_44px_-24px_rgba(26,22,18,.35)]">
          <SceneFrame def={def} index={index} />
        </div>

        <div>
          <ol className="space-y-1.5" aria-label="Steps">
            {lesson.steps.map((s, i) => {
              const on = frame.step === i;
              return (
                <li key={i}>
                  {/* a div, not a button: a step's text can hold a link */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => jumpToStep(i, reduced ? "last" : "first")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        jumpToStep(i, reduced ? "last" : "first");
                      }
                    }}
                    aria-current={on ? "step" : undefined}
                    className={`flex w-full cursor-pointer gap-3 rounded-[12px] px-3 py-2.5 text-left text-[14px] leading-relaxed outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 ${
                      on ? "bg-white/85 text-ink shadow-[0_0_0_1px_rgba(26,22,18,.06),0_1px_2px_rgba(26,22,18,.05)]" : "text-ink-2 hover:bg-white/45"
                    }`}
                  >
                    <span
                      className={`mt-[2px] flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums transition-colors ${
                        on ? "bg-accent text-white" : "bg-[rgba(26,22,18,.06)] text-muted"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span>
                      <StepText text={s} />
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
          <LessonAction lesson={lesson} />
        </div>
      </div>

      {lesson.tryIt.kind === "sandbox" && (
        <div className="mt-8">
          <TryIt lesson={lesson} onDone={() => markTried(lesson.slug)} />
        </div>
      )}

      <nav aria-label="Lessons" className="mt-10 flex items-center justify-between gap-4 border-t hairline pt-5">
        {prev ? (
          <Link href={`/guide/${prev.slug}`} className="group flex min-w-0 items-center gap-2 text-[14px] text-muted no-underline hover:text-ink">
            <span aria-hidden="true" className="transition-transform group-hover:-translate-x-0.5">
              ←
            </span>
            <span className="truncate">{prev.title}</span>
          </Link>
        ) : (
          <Link href="/guide" className="flex items-center gap-2 text-[14px] text-muted no-underline hover:text-ink">
            <span aria-hidden="true">←</span>
            How to use Brief
          </Link>
        )}
        {next ? (
          <Link href={`/guide/${next.slug}`} className="btn-accent shrink-0">
            Next: {next.title}
            <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <Link href="/guide" className="btn-accent shrink-0">
            Back to all lessons
          </Link>
        )}
      </nav>
    </div>
  );
}
