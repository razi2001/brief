"use client";

import { useEffect, useRef, useState } from "react";
import "rrweb-player/dist/style.css";

/**
 * The replay attached from the extension (replay.json: rrweb events + the edit).
 * Plays the recorded page, not a video: rrweb rebuilds the DOM in a sandboxed
 * iframe. The edit is applied here: `crop` ({x, y, w, h} in 0..1) frames part of
 * the page, and the voice-over (replay-voice.webm) plays in sync from `voice.offsetMs`.
 */
type Crop = { x: number; y: number; w: number; h: number };
type RrPlayer = {
  play: () => void;
  pause: () => void;
  goto: (ms: number, play?: boolean) => void;
  getReplayer: () => { getCurrentTime: () => number; on: (ev: string, fn: () => void) => void };
  getMetaData: () => { totalTime: number };
  $destroy?: () => void;
};

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function ReplayPlayer({ url, voiceUrl }: { url: string; voiceUrl?: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const player = useRef<RrPlayer | null>(null);
  const voice = useRef<{ offsetMs: number; durationMs: number } | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);
  const playingRef = useRef(false); // what the rAF loop reads; set with `playing`

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    (async () => {
      try {
        const [res, mod] = await Promise.all([fetch(url), import("rrweb-player")]);
        if (!res.ok) throw new Error(String(res.status));
        const file = await res.json();
        if (!Array.isArray(file?.events) || file.events.length < 2) throw new Error("empty");
        if (cancelled) return;
        const meta = file.events.find((e: { type: number }) => e.type === 4)?.data ?? {};
        const W = meta.width || 1280;
        const H = meta.height || 800;
        const crop: Crop = file.crop ?? { x: 0, y: 0, w: 1, h: 1 };
        voice.current = file.voice ?? null;
        setAspect((W * crop.w) / (H * crop.h));
        await new Promise((r) => requestAnimationFrame(r));
        if (cancelled || !frame.current || !inner.current) return;
        // the page drawn at a scale where the cropped part fills the frame
        const fw = frame.current.clientWidth;
        const pw = fw / crop.w;
        const ph = (pw * H) / W;
        inner.current.style.transform = `translate(${-crop.x * pw}px, ${-crop.y * ph}px)`;
        const Player = (mod as unknown as { default: new (o: unknown) => RrPlayer }).default;
        const p = new Player({
          target: inner.current,
          props: { events: file.events, width: pw, height: ph, autoPlay: false, showController: false, skipInactive: false, mouseTail: false },
        });
        player.current = p;
        setTotal(p.getMetaData().totalTime);
        p.getReplayer().on("finish", () => { playingRef.current = false; setPlaying(false); });
        const tick = () => {
          const now = p.getReplayer().getCurrentTime();
          setT(now);
          const v = voice.current;
          const a = audio.current;
          if (v && a) {
            const rel = (now - v.offsetMs) / 1000;
            const inside = rel >= 0 && rel < v.durationMs / 1000;
            if (playingRef.current && inside) {
              if (Math.abs(a.currentTime - rel) > 0.25) a.currentTime = rel;
              if (a.paused) a.play().catch(() => {});
            } else if (!a.paused) a.pause();
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      try { player.current?.$destroy?.(); } catch {}
      player.current = null;
    };
  }, [url]);

  function toggle() {
    const p = player.current;
    if (!p) return;
    if (playing) { p.pause(); playingRef.current = false; setPlaying(false); return; }
    if (t >= total - 50) p.goto(0, true); else p.play();
    playingRef.current = true;
    setPlaying(true);
  }

  if (failed) return <p className="bg-surface-2 p-6 text-center text-xs text-muted">Replay unavailable</p>;

  return (
    <div className="bg-ink">
      <div
        ref={frame}
        onClick={toggle}
        className="relative w-full cursor-pointer overflow-hidden bg-white"
        style={{ aspectRatio: aspect ? String(aspect) : "16 / 10" }}
      >
        <div ref={inner} className="absolute left-0 top-0 origin-top-left [&_.rr-player]:!bg-transparent [&_.rr-player]:!shadow-none" />
      </div>
      <div className="flex items-center gap-3 border-t border-hairline bg-surface px-3 py-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink text-cream transition-opacity hover:opacity-85"
        >
          {playing ? (
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>
          )}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(1, total)}
          value={Math.min(t, total)}
          onChange={(e) => player.current?.goto(Number(e.target.value), playing)}
          aria-label="Seek"
          className="h-1 min-w-0 flex-1 accent-[#dd6936]"
        />
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
          {clock(t)} / {clock(total)}
        </span>
      </div>
      {voiceUrl && <audio ref={audio} src={voiceUrl} preload="auto" />}
    </div>
  );
}
