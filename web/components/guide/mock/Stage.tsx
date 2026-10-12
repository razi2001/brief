import type { ReactNode } from "react";
import BrandMark from "@/components/BrandMark";
import { IconCursor } from "./icons";
import "./guide.css";

/** The illustration's frame: 16:10, scales with its width (see guide.css). */
export function Stage({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`gd-stage ${className}`}>
      <div className="gd-canvas">{children}</div>
    </div>
  );
}

/**
 * The pointer. `k` is the frame index: a new value replays the press and the
 * ripple, so the same spot can be clicked twice in a row.
 */
export function Cursor({ at, click, hidden, k }: { at: readonly [number, number]; click?: boolean; hidden?: boolean; k: number }) {
  const pos = { left: `${at[0]}%`, top: `${at[1]}%` };
  return (
    <>
      <span className={`gd-cursor${click ? " press" : ""}`} style={{ ...pos, opacity: hidden ? 0 : 1 }} aria-hidden="true">
        <IconCursor key={k} />
      </span>
      {click && !hidden && <span key={`r${k}`} className="gd-ripple" style={pos} aria-hidden="true" />}
    </>
  );
}

/** Keys being pressed, big, over the scene. */
export function Keys({ keys, k }: { keys: string[]; k: number }) {
  return (
    <div key={k} className="gd-keys" aria-hidden="true">
      {keys.map((key, i) => (
        <span key={key} style={{ display: "contents" }}>
          {i > 0 && <span className="plus">+</span>}
          <span className="gd-key" style={{ animationDelay: `${0.15 + i * 0.18}s` }}>
            {key}
          </span>
        </span>
      ))}
    </div>
  );
}

/** Brief's toast on the page (one-click reports). */
export function Toast({ busy, title, sub }: { busy?: boolean; title: string; sub?: string }) {
  return (
    <div className="gd-toast">
      <BrandMark className={`mk${busy ? " busy" : ""}`} />
      <span>
        <div>{title}</div>
        {sub && <div className="sub">{sub}</div>}
      </span>
    </div>
  );
}

/** n design units (1/800 of the stage width), for inline styles. */
export const u = (n: number) => `calc(${n} * var(--u))`;

/** The Brief mark at n units. */
export function Mark({ size }: { size: number }) {
  return (
    <span className="gd-fill" style={{ display: "inline-block", width: u(size), height: u(size), flex: "0 0 auto" }}>
      <BrandMark />
    </span>
  );
}
