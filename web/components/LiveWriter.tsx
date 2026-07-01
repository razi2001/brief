"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mdToHtml } from "@/lib/md-html";

/** A skeleton bar that rises in (staggered) - reads as a line being written. */
function Bar({ w, h = 14, delay = 0 }: { w: string; h?: number; delay?: number }) {
  return <div className="sk sk-rise" style={{ width: w, height: h, animationDelay: `${delay}ms` }} />;
}

/** The pre-stream placeholder: a document taking shape, not a blank card. */
function WritingSkeleton({ title }: { title?: string | null }) {
  return (
    <>
      {title ? (
        <h1 className="font-display text-3xl leading-[1.08] text-ink sm:text-[2.7rem]">{title}</h1>
      ) : (
        <div className="flex flex-col gap-2.5">
          <Bar w="78%" h={30} />
          <Bar w="46%" h={30} delay={80} />
        </div>
      )}
      <div className="mt-8 flex flex-col gap-3">
        <Bar w="100%" delay={120} />
        <Bar w="94%" delay={200} />
        <Bar w="71%" delay={280} />
        <div className="h-3" />
        <Bar w="34%" h={11} delay={380} />
        <Bar w="88%" delay={460} />
        <Bar w="60%" delay={540} />
        <div className="h-3" />
        <div className="sk sk-rise" style={{ width: "100%", height: 84, borderRadius: 12, animationDelay: "640ms" }} />
        <div className="h-3" />
        <Bar w="80%" delay={760} />
        <span className="inline-flex items-center gap-1">
          <Bar w="42%" delay={840} />
          <span className="writing-caret" />
        </span>
      </div>
    </>
  );
}

/**
 * Streams the AI writing the draft, token by token, into the brief page - the
 * real-time "writing" view. Connects once to the stream endpoint. Until the
 * first token lands we show a skeleton (a document taking shape, never a blank
 * card with the word "Writing"); once text arrives we render the Markdown live,
 * then soft-refresh to the finished, persisted draft when the stream ends.
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

  // No tokens yet → skeleton (uses the real title if the user named the capture).
  if (!text.trim()) return <WritingSkeleton title={fallbackTitle} />;

  // Split the streamed Markdown into a title (first "# " line) + body.
  const m = /^#\s+(.+)$/m.exec(text);
  const title = m ? m[1].trim() : "";
  const body = m ? text.slice(m.index + m[0].length).trim() : text;

  return (
    <>
      {title ? (
        <h1 className="font-display text-3xl leading-[1.08] text-ink sm:text-[2.7rem]">{title}</h1>
      ) : fallbackTitle ? (
        <h1 className="font-display text-3xl leading-[1.08] text-ink sm:text-[2.7rem]">{fallbackTitle}</h1>
      ) : (
        <div className="flex flex-col gap-2.5">
          <Bar w="78%" h={30} />
          <Bar w="46%" h={30} delay={80} />
        </div>
      )}
      <div
        className="ticket-prose mt-6"
        dangerouslySetInnerHTML={{ __html: mdToHtml(body) + '<span class="writing-caret"></span>' }}
      />
    </>
  );
}
