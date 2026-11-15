"use client";
import { Real } from "./Real";
import "./real/bar.css";

/** bar.js's bar count, and a still of the wave while you speak. */
const WAVE = Array.from({ length: 18 }, (_, i) => {
  const mid = 8.5;
  const fall = 1 - Math.abs(i - mid) / mid;
  return Math.round(3 + 15 * fall * (0.55 + 0.45 * Math.abs(Math.sin(i * 1.7))));
});

/**
 * The recording bar, drawn by the extension's own stylesheet (real/bar.css,
 * a scoped copy of extension/bar.css) on bar.html's markup: 3, 2, 1 with
 * "Voice on", then the red dot and the time, the wave of your voice, mute and
 * stop. Placed as content.js places its frame: 400 by 104 pixels, 52 above the
 * bottom of the page, centred.
 */
export function MockBar({ count, time }: { count?: number; time?: string }) {
  const state = count !== undefined ? "countdown" : "recording";
  return (
    <Real className="gd-barwrap">
      <div className="gd-barframe">
        <div className={`xb state-${state}`}>
          <div id="root">
            <div className="bar">
              <div data-state="countdown" className="state-inner">
                <span key={count} className="cd-num">
                  {count}
                </span>
                <div className="cd-track" aria-hidden="true">
                  <i />
                </div>
                <span className="cd-voice">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="2.5" width="6" height="12" rx="3" />
                    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
                  </svg>
                  Voice on
                </span>
                <span className="icon-btn">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </span>
              </div>
              <div data-state="recording" className="state-inner">
                <span className="rec">
                  <i className="rec-dot" />
                  <span className="timer">{time ?? "00:00"}</span>
                </span>
                <div className="wave speaking">
                  <div className="wave-bars" aria-hidden="true">
                    {WAVE.map((h, i) => (
                      <i key={i} className="gd-wave" style={{ height: h, animationDelay: `${(i % 7) * 90}ms` }} />
                    ))}
                  </div>
                </div>
                <span className="icon-btn mic">
                  <svg className="on" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="2.5" width="6" height="12" rx="3" />
                    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
                  </svg>
                </span>
                <span data-gd="stop" className="stop-btn">
                  <span className="stop-square" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Real>
  );
}
