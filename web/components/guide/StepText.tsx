import type { ReactNode } from "react";

const isMacKey = (k: string) => k === "Cmd";

/** A key, as a chip. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.6em] items-center justify-center rounded-[6px] border border-b-2 border-[rgba(26,22,18,.16)] bg-white px-1.5 py-px font-sans text-[0.82em] font-medium text-ink shadow-[0_1px_0_rgba(26,22,18,.04)]">
      {children}
    </kbd>
  );
}

/** Lesson copy's tiny markup: **bold**, *italic*, [[Alt+Shift+B]] keys, [label](https://...) links. */
export default function StepText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /\[\[(.+?)\]\]|\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\((https?:[^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      const keys = m[1].split("+");
      out.push(
        <span key={n++} className="inline-flex items-center gap-0.5 align-[0.05em]">
          {keys.map((k, i) => (
            <span key={k} className="inline-flex items-center gap-0.5">
              {i > 0 && <span className="text-muted">+</span>}
              <Kbd>{isMacKey(k) ? "⌘" : k}</Kbd>
            </span>
          ))}
        </span>,
      );
    } else if (m[2]) out.push(<strong key={n++} className="font-semibold text-ink">{m[2]}</strong>);
    else if (m[3]) out.push(<em key={n++} className="font-display text-[1.12em] text-accent">{m[3]}</em>);
    else if (m[4])
      out.push(
        <a key={n++} href={m[5]} target="_blank" rel="noopener" className="font-semibold text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
          {m[4]}
        </a>,
      );
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
