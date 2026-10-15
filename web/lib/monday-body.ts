// Pure helpers for monday items: which columns carry status, priority and the
// assignee, what a value looks like in the JSON a column takes, and the
// description posted as the item's first update. Split out of monday.ts to
// keep the adapter itself about the API.

import { mdToHtml } from "./md-html";
import { evidenceIndexes, evidenceLabel, placeEvidence } from "./ticket-body";
import { STATUS_COLOR, matchPriorityLabel, resolveName, type TrackerPriority } from "./tracker";

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/** A board column as `boards { columns }` returns it. */
export type MondayColumn = {
  id: string;
  title: string;
  type: string;
  settings_str?: string | null;
};

/**
 * The column that carries workflow status.
 *
 * monday has no built-in status field: a board has any number of "status"
 * type columns, and teams routinely keep a Priority column of that same type
 * next to the real one. One literally titled Status wins; otherwise the first
 * status column that is not the priority one.
 */
export function statusColumn<C extends { title: string; type: string }>(cols: C[]): C | undefined {
  const statuses = cols.filter((c) => c.type === "status");
  return (
    statuses.find((c) => /status/i.test(c.title)) ??
    statuses.find((c) => !/priority/i.test(c.title))
  );
}

/** A status-type column used for priority, which is how monday's templates model it. */
export function priorityColumn<C extends { title: string; type: string }>(cols: C[]): C | undefined {
  return cols.find((c) => c.type === "status" && /priority/i.test(c.title));
}

/**
 * Where the assignee goes. A board can carry several people columns (an
 * Owner and a Reviewer, say), so one titled like an assignee wins over the
 * first one.
 */
export function peopleColumn<C extends { title: string; type: string }>(cols: C[]): C | undefined {
  const people = cols.filter((c) => c.type === "people");
  return people.find((c) => /assignee|owner|assigned/i.test(c.title)) ?? people[0];
}

/**
 * The labels a status or dropdown column offers, read from its settings.
 *
 * A status column stores them as an index-keyed object, and keeps an empty
 * string for the blank "Default" slot, which is not a value anyone can pick.
 * A dropdown stores a list of `{ id, name }`.
 */
export function columnLabels(col: { type: string; settings_str?: string | null }): string[] {
  let settings: { labels?: unknown };
  try {
    settings = JSON.parse(col.settings_str || "{}") as { labels?: unknown };
  } catch {
    return [];
  }
  const labels = settings?.labels;
  if (col.type === "status" && labels && typeof labels === "object" && !Array.isArray(labels)) {
    return Object.values(labels as Record<string, unknown>).filter(
      (v): v is string => typeof v === "string" && !!v.trim(),
    );
  }
  if (col.type === "dropdown" && Array.isArray(labels)) {
    return labels
      .map((l) => (l as { name?: unknown })?.name)
      .filter((n): n is string => typeof n === "string" && !!n.trim());
  }
  return [];
}

/**
 * Column types that are never offered as custom fields: computed or read-only
 * (formula, mirror, auto number, item id, progress, the creation and update
 * logs, time tracking), structural (subitems, links to other boards,
 * dependencies, docs, integrations), or not a value at all (files, buttons,
 * votes). Offering them would only invite a value monday then refuses.
 */
export const UNSETTABLE_TYPES = new Set([
  "name",
  "subtasks",
  "formula",
  "mirror",
  "auto_number",
  "item_id",
  "progress",
  "creation_log",
  "last_updated",
  "time_tracking",
  "board_relation",
  "dependency",
  "doc",
  "direct_doc",
  "integration",
  "file",
  "button",
  "vote",
  "unsupported",
]);

/** The JSON a column type takes when it can't be set from a plain string, named in the error so the agent can retry. */
const VALUE_SHAPES: Record<string, string> = {
  link: '{"url": "https://...", "text": "..."}',
  checkbox: '{"checked": "true"}',
  email: '{"email": "name@example.com", "text": "name@example.com"}',
};

/**
 * Pick the board's own label for a normalized priority.
 *
 * monday's stock Priority column labels its top value "Critical" followed by
 * a warning emoji, and matchPriorityLabel compares whole words, so the emoji
 * alone would hide it. The labels are matched with symbols stripped, and the
 * original spelling is what gets written back.
 */
export function pickPriorityLabel(priority: TrackerPriority, labels: string[]): string | undefined {
  const cleaned = labels.map((l) => l.replace(/[^A-Za-z0-9\u00C0-\u024F\s:_-]/g, "").trim());
  const hit = matchPriorityLabel(priority, cleaned);
  return hit === undefined ? undefined : labels[cleaned.indexOf(hit)];
}

/** One column value on an item, flattened from `column_values { id type text column { title } }`. */
type ItemColumn = { id: string; type: string; title: string; text: string };

export type RawColumnValue = {
  id: string;
  type: string;
  text?: string | null;
  column?: { title?: string | null } | null;
};

export function itemColumns(values: RawColumnValue[] | null | undefined): ItemColumn[] {
  return (values ?? []).map((v) => ({
    id: v.id,
    type: v.type,
    title: v.column?.title ?? v.id,
    text: (v.text ?? "").trim(),
  }));
}

/** A status label on monday is free text, so the color is read from what it says. */
export function mondayStateColor(stateName: string): string {
  if (/done|complete/i.test(stateName)) return STATUS_COLOR.done;
  if (/working|progress|review|stuck/i.test(stateName)) return STATUS_COLOR.active;
  return STATUS_COLOR.neutral;
}

/** The people column's text lists everyone, comma separated; the first is the assignee. */
export function firstPerson(text: string): string | undefined {
  const first = text.split(",")[0]?.trim();
  return first || undefined;
}

/** A custom-field value in the JSON shape monday's column type expects. */
export function extraColumnValue(col: MondayColumn, v: unknown): { value?: unknown; error?: string } {
  // Already shaped for monday (the agent passed `{ "url": ..., "text": ... }`
  // for a link column, say): send it as it is.
  if (v && typeof v === "object" && !Array.isArray(v)) return { value: v };
  switch (col.type) {
    case "status": {
      const labels = columnLabels(col);
      const label = resolveName(String(v), labels);
      return label
        ? { value: { label } }
        : { error: `Unknown value "${String(v)}" for ${col.title}. Valid: ${labels.join(", ")}` };
    }
    case "dropdown": {
      const labels = columnLabels(col);
      const wants = (Array.isArray(v) ? v : [v]).map(String);
      const resolved = wants.map((w) => resolveName(w, labels));
      const missing = wants.filter((_, i) => !resolved[i]);
      return missing.length
        ? { error: `Unknown value "${missing.join(", ")}" for ${col.title}. Valid: ${labels.join(", ")}` }
        : { value: { labels: resolved as string[] } };
    }
    case "date": {
      const m = /^\d{4}-\d{2}-\d{2}/.exec(String(v).trim());
      return m ? { value: { date: m[0] } } : { error: `${col.title} takes a date as YYYY-MM-DD.` };
    }
    case "text":
    case "numbers":
      return { value: String(v) };
    case "long_text":
      // The only column of the three whose JSON form is an object.
      return { value: { text: String(v) } };
    default: {
      const shape = VALUE_SHAPES[col.type];
      return {
        error: shape
          ? `${col.title} (a ${col.type} column) takes an object like ${shape}.`
          : `${col.title} (a ${col.type} column) cannot be set from a plain value; pass monday's JSON for a ${col.type} column.`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Body and evidence
// ---------------------------------------------------------------------------

/**
 * Build the item's description, in markdown.
 *
 * The images are files attached to the update, not inline pictures (an update
 * body cannot reference its own attachments), so what the body carries is
 * each caption next to the name of the file it describes. Two rules from the
 * GitHub adapter apply here too:
 *
 *  - The agent sometimes writes its own "## Evidence" section (or a bold
 *    "**Evidence**" label). The captions go INSIDE that section, before
 *    whatever section follows it, so the ticket never shows the heading twice.
 *  - With no caption at all there is nothing to say: the attachments already
 *    sit right under the update, and a bare list of their names is noise.
 */
export function buildMondayBody(
  descriptionMarkdown: string,
  evidence: Array<{ contentType: string; caption?: string }>,
): string {
  const body = (descriptionMarkdown ?? "").replace(/\s+$/, "");
  if (!evidence.some((e) => e.caption?.trim())) return body;

  // Screenshots are numbered as their files are (evidenceFileName), so a
  // caption names the attachment it describes.
  const indexes = evidenceIndexes(evidence);
  const lines = evidence.map((e, i) => {
    const cap = e.caption?.trim();
    const label = evidenceLabel(e.contentType, indexes[i]);
    return cap ? `- **${label}:** ${cap}` : `- **${label}**`;
  });
  return placeEvidence(body, lines.join("\n"));
}

/**
 * Markdown to the HTML an update body takes. mdToHtml has no rule for a
 * thematic break, so the divider withBriefAttribution puts above the
 * attribution would otherwise show up as a literal "---" paragraph.
 */
export function mondayHtml(markdown: string): string {
  return mdToHtml(markdown).replace(/<p>-{3,}<\/p>/g, "<hr>");
}

/**
 * The same body with every tag removed, one block per line. The last resort
 * when monday refuses the HTML: a description without formatting still beats
 * an item with none. Entities stay encoded, so text that looked like a tag in
 * the report can't become one here.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h\d|li|pre|blockquote|tr|table|ul|ol)>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n---\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
