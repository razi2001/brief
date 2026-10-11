"use client";
import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import ConnectView from "@/components/ConnectView";

export default function Connect() {
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");
  const { isLoaded, user } = useUser();
  useEffect(() => {
    if (!isLoaded) return;
    const extId = new URLSearchParams(window.location.search).get("ext");
    (async () => {
      try {
        const res = await fetch("/api/extension-token", { method: "POST" });
        if (!res.ok) { setState("err"); return; }
        const { token } = await res.json();
        const w = window as unknown as { chrome?: { runtime?: { sendMessage?: (id: string, msg: unknown, cb?: () => void) => void } } };
        if (extId && w.chrome?.runtime?.sendMessage) {
          w.chrome.runtime.sendMessage(extId, { type: "brief-cloud-token", token }, () => {
            // Remember the pairing so ExtensionTokenSync can silently re-pair
            // when a DIFFERENT account signs in later (always in sync).
            try {
              localStorage.setItem("briefExtId", extId);
              if (user?.id) localStorage.setItem("briefExtSyncedUser", user.id);
            } catch {}
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
  }, [isLoaded, user]);
  return <ConnectView state={state} />;
}
