"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Cursor, Keys, Stage } from "./mock/Stage";
import type { SceneDef } from "./scenes/types";
import { SCENES } from "./scenes";
import type { SceneKey } from "@/lib/guide/lessons";

type Pt = readonly [number, number];

/** Where a frame's target sits in its stage, in % (center, or an edge). */
function measure(root: HTMLElement, target: string): Pt | null {
  const [name, edge] = target.split(":");
  const el = root.querySelector(`[data-gd="${name}"]`);
  if (!el) return null;
  const r = root.getBoundingClientRect();
  const b = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const x = edge === "left" ? b.left + 2 : edge === "right" ? b.right - 2 : b.left + b.width / 2;
  return [((x - r.left) / r.width) * 100, ((b.top + b.height / 2 - r.top) / r.height) * 100];
}

/**
 * One frame of a scene: the view, the cursor and any keys. A frame that names
 * a target is measured on a hidden copy of itself with every animation
 * settled, so the cursor lands on the real element; one with no cursor keeps
 * it where it was, hidden.
 */
export function SceneFrame({ def, index, still = false }: { def: SceneDef<unknown>; index: number; still?: boolean }) {
  const frame = def.frames[index];
  const View = def.View;
  const ghost = useRef<HTMLDivElement>(null);
  // the last target measured: where the cursor is while a frame has none
  const [pt, setPt] = useState<Pt | null>(null);

  useLayoutEffect(() => {
    if (still || !frame.target || !ghost.current) return;
    const at = measure(ghost.current, frame.target);
    if (at) setPt(at);
  }, [still, frame.target, index]);

  const at = frame.target ? pt : frame.cursor;
  let rest: Pt | undefined = pt ?? undefined;
  for (let i = index - 1; !rest && i >= 0; i--) rest = def.frames[i].cursor;

  return (
    <Stage>
      <View s={frame.s} />
      {!still && frame.target && (
        <div ref={ghost} className="gd-ghost" aria-hidden="true">
          <View s={frame.s} />
        </div>
      )}
      {!still && frame.keys && <Keys keys={frame.keys} k={index} />}
      {!still && <Cursor at={at ?? rest ?? [50, 50]} click={frame.click && !!at} hidden={!at} k={index} />}
    </Stage>
  );
}

/** A frame by scene key (usable from a server component). */
export function SceneByKey({ scene, index, still }: { scene: SceneKey; index: number; still?: boolean }) {
  return <SceneFrame def={SCENES[scene]} index={index} still={still} />;
}

/** Plays only while on screen and while the tab is in front. */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(false);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== "hidden");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return seen && visible;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
