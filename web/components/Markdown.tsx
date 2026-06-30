import React from "react";

/**
 * Tiny, dependency-free Markdown renderer for the agent-written ticket body.
 * Handles the subset the agent actually emits - headings, bold/italic, inline
 * code, fenced code blocks, ordered/unordered lists, links, and paragraphs.
 *
 * It builds React nodes directly (never dangerouslySetInnerHTML), so the body
 * text can't inject HTML, and link hrefs are restricted to http(s).
 */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // `code` | **bold** | *italic* | [label](url)
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
          className="rounded bg-cream-2 px-1 py-0.5 font-mono text-[0.85em] text-ink-2"
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
      nodes.push(
        <em key={`${keyPrefix}-i${i}`}>{tok.slice(1, -1)}</em>,
      );
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
            className="text-accent underline underline-offset-2"
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
      i++; // closing fence
      blocks.push(
        <pre
          key={key++}
          className="my-3 overflow-x-auto rounded-lg border border-hairline bg-cream-2/50 p-3 text-[0.8125rem] leading-relaxed text-ink-2"
        >
          <code className="font-mono">{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Heading
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const content = renderInline(h[2], `h${key}`);
      if (level <= 1) {
        blocks.push(
          <h2 key={key++} className="mt-5 mb-2 font-display text-2xl text-ink">
            {content}
          </h2>,
        );
      } else if (level === 2) {
        blocks.push(
          <h3 key={key++} className="mt-5 mb-2 font-display text-xl text-ink">
            {content}
          </h3>,
        );
      } else {
        blocks.push(
          <h4
            key={key++}
            className="mt-4 mb-1.5 font-mono text-xs uppercase tracking-wider text-muted"
          >
            {content}
          </h4>,
        );
      }
      i++;
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const txt = lines[i].replace(/^\s*[-*]\s+/, "");
        items.push(
          <li key={items.length}>{renderInline(txt, `ul${key}-${items.length}`)}</li>,
        );
        i++;
      }
      blocks.push(
        <ul key={key++} className="my-2 list-disc space-y-1 pl-5 text-ink-2">
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
        items.push(
          <li key={items.length}>{renderInline(txt, `ol${key}-${items.length}`)}</li>,
        );
        i++;
      }
      blocks.push(
        <ol key={key++} className="my-2 list-decimal space-y-1 pl-5 text-ink-2">
          {items}
        </ol>,
      );
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph (gather consecutive plain lines)
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
    blocks.push(
      <p key={key++} className="my-2 leading-relaxed text-ink-2">
        {renderInline(para.join(" "), `p${key}`)}
      </p>,
    );
  }

  // break-words + overflow-wrap:anywhere so long unbroken strings (e.g. a giant
  // URL in a Context line) wrap inside the column instead of blowing out the page
  // width. overflow-wrap is inherited, so it reaches every block below.
  return <div className="text-[0.9375rem] break-words [overflow-wrap:anywhere]">{blocks}</div>;
}
