"use client";
import { useEffect, useState } from "react";

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
          w.chrome.runtime.sendMessage(extId, { type: "brief-cloud-token", token }, () => setState("ok"));
        } else {
          setState("err");
        }
      } catch {
        setState("err");
      }
    })();
  }, []);
  return (
    <main style={{ maxWidth: 420, margin: "12vh auto", fontFamily: "system-ui", textAlign: "center" }}>
      <h1>✦ Connecting Brief</h1>
      {state === "idle" && <p>Pairing…</p>}
      {state === "ok" && <p>Connected. You can close this tab and return to the extension.</p>}
      {state === "err" && <p>Couldn’t reach the extension. Make sure Brief is installed, then try again from the extension.</p>}
    </main>
  );
}
