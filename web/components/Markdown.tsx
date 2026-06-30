import React from "react";

/**
 * Tiny, dependency-free Markdown renderer tuned for the agent-written ticket
 * body. Builds React nodes directly (never dangerouslySetInnerHTML) and only
 * allows http(s) link hrefs.
 *
 * Structure-aware: a paragraph that starts with a bold label ("**Expected** the
 * page…") renders as a labeled field block - a small uppercase label above its
 * body - so the ticket reads as clean sections instead of a run-on. A lone bold
 * label, or a #/## heading, renders as a section heading.
 */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      nodes.push(
        <code
          key={`${keyPrefix}-c${i}`}
          className="rounded bg-cream-2/70 px-1.5 py-0.5 font-mono text-[0.85em] text-ink"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-ink">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("*")) {
      nodes.push(<em key={`${keyPrefix}-i${i}`}>{tok.slice(1, -1)}</em>);
    } else {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      if (link) {
        const href = /^https?:\/\//i.test(link[2]) ? link[2] : "#";
        nodes.push(
          <a
            key={`${keyPrefix}-l${i}`}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
          >
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(tok);
      }
    }
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const BODY = "text-[0.9rem] leading-[1.75] text-ink-2";
const SECTION_LABEL =
  "mb-1 font-mono text-[0.6875rem] font-bold uppercase tracking-[0.09em] text-ink-2";

function Heading({ children, kkey }: { children: React.ReactNode; kkey: number }) {
  return (
    <h3 key={kkey} className="mt-7 mb-2 font-mono text-[1.0625rem] font-semibold tracking-tight text-ink">
      {children}
    </h3>
  );
}

export default function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(
        <pre
          key={key++}
          className="my-4 overflow-x-auto rounded-xl border border-hairline bg-ink/[0.04] p-3.5 font-mono text-[0.8125rem] leading-relaxed text-ink-2"
        >
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Heading (#/##/###)
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<Heading key={key} kkey={key++}>{renderInline(h[2], `h${key}`)}</Heading>);
      i++;
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const txt = lines[i].replace(/^\s*[-*]\s+/, "");
        items.push(<li key={items.length}>{renderInline(txt, `ul${key}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(
        <ul key={key++} className={`my-3 list-disc space-y-1.5 pl-5 ${BODY} marker:text-muted`}>
          {items}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const txt = lines[i].replace(/^\s*\d+\.\s+/, "");
        items.push(<li key={items.length}>{renderInline(txt, `ol${key}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(
        <ol key={key++} className={`my-3 list-decimal space-y-1.5 pl-5 ${BODY} marker:text-muted marker:font-mono`}>
          {items}
        </ol>,
      );
      continue;
    }

    // Blank
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph - gather consecutive plain lines
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith("```")
    ) {
      para.push(lines[i]);
      i++;
    }
    const text = para.join(" ");

    // Leading bold label → labeled section ("**Expected** the page…"), or a lone
    // label → section heading.
    const labelled = /^\*\*([^*]+)\*\*[:：]?\s*([\s\S]*)$/.exec(text);
    if (labelled && labelled[1].length <= 40) {
      const label = labelled[1].trim();
      const rest = labelled[2].trim();
      if (!rest) {
        blocks.push(<Heading key={key} kkey={key++}>{label}</Heading>);
      } else {
        blocks.push(
          <div key={key++} className="mt-5">
            <div className={SECTION_LABEL}>{label}</div>
            <p className={BODY}>{renderInline(rest, `f${key}`)}</p>
          </div>,
        );
      }
      continue;
    }

    blocks.push(
      <p key={key++} className={`mt-4 first:mt-0 ${BODY}`}>
        {renderInline(text, `p${key}`)}
      </p>,
    );
  }

  return <div className="break-words [overflow-wrap:anywhere]">{blocks}</div>;
}
