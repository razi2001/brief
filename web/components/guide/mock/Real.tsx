"use client";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** How wide the browser page in the illustrations is, in real CSS pixels. */
export const PAGE_PX = 1000;

/**
 * Real pixels inside an illustration: fills its parent (the page of a mock
 * browser window) and draws `children` on a page `width` pixels wide, scaled to
 * fit. So the app and the extension are drawn by their own stylesheets at
 * their own sizes, and only shrink as a whole. CSS does the scaling where the
 * browser can divide lengths (guide.css, .gd-real); elsewhere it is measured
 * here once the page runs.
 */
export function Real({ children, width = PAGE_PX, className = "", style }: { children: ReactNode; width?: number; className?: string; style?: CSSProperties }) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ k: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    // CSS scales it where it can (guide.css); measuring is the fallback
    if (!el || typeof ResizeObserver === "undefined" || CSS.supports?.("scale: calc(1px / 1px)")) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0) setFit({ k: w / width, h: h / (w / width) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div ref={box} className={`gd-real ${className}`} style={style}>
      <div
        className="gd-real-in"
        style={{
          width,
          ["--real-w" as string]: `${width}px`,
          ...(fit ? { height: fit.h, transform: `scale(${fit.k})` } : {}),
        }}
      >
        {children}
      </div>
    </div>
  );
}
