"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AutoFacts } from "@/lib/guide/progress";

const Facts = createContext<AutoFacts>({});

/**
 * What the app knows about you (tracker, extension, rules...), fetched once
 * by the Guide's layout and shared by every lesson: moving between lessons
 * asks the server for nothing. The page draws at once; ticks fill in when the
 * answer lands.
 */
export function GuideFactsProvider({ facts, children }: { facts: Promise<AutoFacts>; children: ReactNode }) {
  const [known, setKnown] = useState<AutoFacts>({});
  useEffect(() => {
    let live = true;
    // what the server streams is a bare thenable (its then() returns nothing):
    // Promise.resolve makes it a real promise before chaining on it
    Promise.resolve(facts)
      .then((f) => live && setKnown(f))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [facts]);
  return <Facts.Provider value={known}>{children}</Facts.Provider>;
}

export const useGuideFacts = () => useContext(Facts);
