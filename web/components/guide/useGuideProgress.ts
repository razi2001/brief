"use client";

import { useCallback, useEffect, useState } from "react";
import { LESSON_SLUGS } from "@/lib/guide/lessons";
import { addTried, parseTried } from "@/lib/guide/progress";

const KEY = "briefGuideTried";
const EVENT = "brief:guide:tried";

function read(): string[] {
  try {
    return parseTried(localStorage.getItem(KEY), LESSON_SLUGS);
  } catch {
    return [];
  }
}

/**
 * The lessons this browser has tried. Per viewer and best-effort: storage can
 * be blocked, and then the Guide simply starts fresh. Every mounted copy
 * stays in step (the hub's cards and a lesson's tick).
 */
export function useGuideProgress() {
  const [tried, setTried] = useState<string[]>([]);

  useEffect(() => {
    const sync = () => setTried(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const markTried = useCallback((slug: string) => {
    const next = addTried(read(), slug);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage blocked: still show it ticked for this visit */
    }
    setTried(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { tried, markTried };
}
