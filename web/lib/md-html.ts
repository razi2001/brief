// Markdown <-> HTML bridge for the ticket body. mdToHtml renders the agent's
// markdown to safe, semantic HTML (text is escaped; only http(s) links) for both
// the read view and the inline WYSIWYG editor. htmlToMarkdown serializes the
// editor's contentEditable HTML back to markdown on save - the structures here
// and there are kept in sync so the round-trip is lossless for the subset the
// agent emits (headings, bold/italic/inline-code, links, lists, code blocks,
// blockquotes, GFM tables).

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Inline: `code`, **bold**, *italic*, [text](url). Input is already HTML-escaped.
function inlineToHtml(escaped: string): string {
  let out = "";
  const re = /(`[^`]+`)|(\*\*\*[^*]+\*\*\*)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(escaped)) !== null) {
    out += escaped.slice(last, m.index);
    const tok = m[0];
    if (tok.startsWith("`")) {
      out += `<code>${tok.slice(1, -1)}</code>`;
    } else if (tok.startsWith("***")) {
      out += `<strong><em>${tok.slice(3, -3)}</em></strong>`;
    } else if (tok.startsWith("**")) {
      out += `<strong>${tok.slice(2, -2)}</strong>`;
    } else if (tok.startsWith("*")) {
      out += `<em>${tok.slice(1, -1)}</em>`;
    } else {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      if (link) {
        const safe = /^https?:\/\//i.test(link[2]) ? link[2] : "#";
        out += `<a href="${safe}" target="_blank" rel="noreferrer noopener">${link[1]}</a>`;
      } else {
        out += tok;
      }
    }
    last = m.index + tok.length;
  }
  out += escaped.slice(last);
  return out;
}

const inline = (raw: string) => inlineToHtml(escapeHtml(raw));

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

export function mdToHtml(md: string): string {
  const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;

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
      html.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // GFM table: a header row followed by a |---|---| separator.
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${header.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody>`;
      html.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // Heading
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(h[1].length + 1, 4); // # -> h2, ## -> h3
      html.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      html.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i++;
      }
      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`);
        i++;
      }
      html.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // Blank
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !lines[i].trim().startsWith("```")
    ) {
      para.push(lines[i]);
      i++;
    }
    html.push(`<p>${inline(para.join(" "))}</p>`);
  }

  return html.join("\n");
}

// ── HTML -> Markdown (editor save). Runs client-side over the contentEditable
// DOM. Mirrors the structures mdToHtml emits. ──────────────────────────────

// Wrap inner text in a markdown marker, keeping any edge whitespace OUTSIDE the
// marker (so `<strong> Actual</strong>` serializes to ` **Actual**`, never the
// invalid `** Actual**`). Empty content drops the marker entirely.
function wrapMark(inner: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  if (!m || !m[2]) return inner;
  return `${m[1]}${mark}${m[2]}${mark}${m[3]}`;
}

function inlineFromNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const inner = childrenInline(el);
  switch (tag) {
    case "strong":
    case "b":
      return wrapMark(inner, "**");
    case "em":
    case "i":
      return wrapMark(inner, "*");
    case "code": {
      const t = el.textContent ?? "";
      return t.trim() ? `\`${t}\`` : t;
    }
    case "a": {
      const href = el.getAttribute("href") || "";
      return href ? `[${inner}](${href})` : inner;
    }
    case "br":
      return "\n";
    default: {
      // execCommand can wrap formatting in styled spans/fonts (e.g.
      // <span style="font-weight: bold">) instead of <b>/<i>. Catch those so
      // bold/italic survive the round-trip instead of being silently dropped.
      let s = inner;
      if (!s.trim()) return s;
      const fw = el.style?.fontWeight ?? "";
      const bold = fw === "bold" || (!!fw && Number.parseInt(fw, 10) >= 600);
      if (el.style?.fontStyle === "italic") s = wrapMark(s, "*");
      if (bold) s = wrapMark(s, "**");
      return s;
    }
  }
}
function childrenInline(el: Node): string {
  let out = "";
  el.childNodes.forEach((c) => (out += inlineFromNode(c)));
  return out;
}

function cellText(el: Element): string {
  return childrenInline(el).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

export function htmlToMarkdown(root: HTMLElement): string {
  const out: string[] = [];

  const block = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? "").trim();
      if (t) out.push(t);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case "h1":
        out.push(`# ${childrenInline(el).trim()}`);
        break;
      case "h2":
        out.push(`# ${childrenInline(el).trim()}`);
        break;
      case "h3":
      case "h4":
        out.push(`## ${childrenInline(el).trim()}`);
        break;
      case "ul":
        out.push(
          Array.from(el.children)
            .filter((c) => c.tagName.toLowerCase() === "li")
            .map((li) => `- ${childrenInline(li).trim()}`)
            .join("\n"),
        );
        break;
      case "ol":
        out.push(
          Array.from(el.children)
            .filter((c) => c.tagName.toLowerCase() === "li")
            .map((li, n) => `${n + 1}. ${childrenInline(li).trim()}`)
            .join("\n"),
        );
        break;
      case "pre":
        out.push("```\n" + (el.textContent ?? "").replace(/\n+$/, "") + "\n```");
        break;
      case "blockquote":
        out.push(
          childrenInline(el)
            .trim()
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n"),
        );
        break;
      case "table": {
        const rows = Array.from(el.querySelectorAll("tr"));
        if (!rows.length) break;
        const head = Array.from(rows[0].children).map((c) => cellText(c));
        const lines = [
          `| ${head.join(" | ")} |`,
          `| ${head.map(() => "---").join(" | ")} |`,
        ];
        for (const r of rows.slice(1)) {
          const cells = Array.from(r.children).map((c) => cellText(c));
          lines.push(`| ${cells.join(" | ")} |`);
        }
        out.push(lines.join("\n"));
        break;
      }
      case "div":
        // A bare div wrapper - recurse into its block children.
        el.childNodes.forEach(block);
        return;
      default:
        // p and anything else inline-ish.
        out.push(childrenInline(el).trim());
    }
  };

  root.childNodes.forEach(block);
  return out
    .map((b) => b.replace(/ /g, " ").trimEnd())
    .filter((b) => b !== "")
    .join("\n\n")
    .trim();
}
