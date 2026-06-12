"use client";
import { useEffect, useState } from "react";
import BrandMark from "@/components/BrandMark";

export default function Connect() {
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");
  useEffect(() => {
    const extId = new URLSearchParams(window.location.search).get("ext");
    (async () => {
      try {
        const res = await fetch("/api/extension-token", { method: "POST" });
        if (!res.ok) { setState("err"); return; }
        const { token } = await res.json();
        const w = window as unknown as { chrome?: { runtime?: { sendMessage?: (id: string, msg: unknown, cb?: () => void) => void } } };
        if (extId && w.chrome?.runtime?.sendMessage) {
          w.chrome.runtime.sendMessage(extId, { type: "brief-cloud-token", token }, () => {
            setState("ok");
            // Paired - drop them on their tickets instead of a dead-end tab.
            setTimeout(() => window.location.replace("/tickets"), 900);
          });
        } else {
          setState("err");
        }
      } catch {
        setState("err");
      }
    })();
  }, []);
  return (
    <main className="min-h-screen text-ink flex flex-col items-center justify-center px-4 py-16">
      <div className="flex flex-col items-center text-center max-w-md">
        <BrandMark size={48} />
        <h1 className="font-display mt-6 text-4xl sm:text-5xl leading-tight text-ink">
          connecting <em className="italic text-accent">Brief</em>
        </h1>
        {state === "idle" && (
          <p className="mt-4 text-sm tracking-wide text-muted">Pairing…</p>
        )}
        {state === "ok" && (
          <p className="mt-4 text-sm tracking-wide text-ink-2">
            <span className="text-accent">Connected ✓</span> - taking you to your tickets…
          </p>
        )}
        {state === "err" && (
          <p className="mt-4 text-sm tracking-wide text-ink-2">
            Couldn&apos;t reach the extension. Make sure Brief is installed, then try
            again from the extension.
          </p>
        )}
      </div>
    </main>
  );
}
