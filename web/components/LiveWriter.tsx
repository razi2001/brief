"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mdToHtml } from "@/lib/md-html";

/**
 * Streams the AI writing the draft, token by token, into the brief page - the
 * real-time "writing" view. Connects once to the stream endpoint, renders the
 * Markdown live (title parsed out as the heading), then soft-refreshes to the
 * finished, persisted draft (with toolbar + evidence) when the stream ends.
 */
export default function LiveWriter({
  briefId,
  fallbackTitle,
}: {
  briefId: string;
  fallbackTitle?: string | null;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/briefs/${briefId}/stream`, {
          method: "POST",
          credentials: "same-origin",
          signal: ctrl.signal,
        });
        if (!res.ok || res.status === 204 || !res.body) {
          router.refresh();
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setText(acc);
        }
        // Stream finished → load the persisted, parsed draft (real toolbar/evidence).
        router.refresh();
      } catch {
        router.refresh();
      }
    })();
    return () => ctrl.abort();
  }, [briefId, router]);

  // Split the streamed Markdown into a title (first "# " line) + body.
  const m = /^#\s+(.+)$/m.exec(text);
  const title = m ? m[1].trim() : "";
  const body = m ? text.slice(m.index + m[0].length).trim() : text;

  return (
    <>
      {title ? (
        <h1 className="font-display text-3xl leading-[1.08] text-ink sm:text-[2.7rem]">{title}</h1>
      ) : (
        <h1 className="font-display text-3xl leading-[1.08] text-ink/70 sm:text-[2.7rem]">
          {fallbackTitle || "Writing…"}
        </h1>
      )}
      <div
        className="ticket-prose mt-6"
        dangerouslySetInnerHTML={{ __html: mdToHtml(body) + '<span class="writing-caret"></span>' }}
      />
    </>
  );
}
