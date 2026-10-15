// Pure helpers for Asana tasks: the notes around the attached evidence, what a
// task's status reads as, and the agent's names and values resolved to the
// gids Asana takes. Split out of asana.ts to keep the adapter itself about the
// API.

import { asanaImage } from "./asana-html";
import { placeEvidence, promoteSectionHeadings, type EvidenceKind } from "./ticket-body";
import { STATUS_COLOR, matchPriorityLabel, resolveName, type TrackerPriority } from "./tracker";

// ---------------------------------------------------------------------------
// Raw shapes (only the fields we ask for with opt_fields)
// ---------------------------------------------------------------------------

export type Compact = { gid: string; name?: string };
export type ProjectRaw = { gid: string; name?: string; notes?: string; team?: { name?: string } | null };
export type EnumOption = { gid: string; name: string; enabled?: boolean };
export type CustomField = {
  gid: string;
  name: string;
  resource_subtype?: string;
  enum_options?: EnumOption[];
};
export type UserRaw = { gid: string; name?: string; email?: string; photo?: { image_60x60?: string } | null };
export type TaskRaw = {
  gid: string;
  name?: string;
  completed?: boolean;
  permalink_url?: string;
  created_at?: string;
  assignee?: UserRaw | null;
  memberships?: Array<{ project?: Compact | null; section?: Compact | null }>;
  projects?: Compact[];
  tags?: Compact[];
  custom_fields?: Array<{ gid: string; name?: string; display_value?: string | null }>;
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** The membership that places the task in a project (and a section of it). */
export function homeMembership(t: TaskRaw): { project?: Compact | null; section?: Compact | null } | undefined {
  return t.memberships?.find((m) => m.project?.gid) ?? t.memberships?.[0];
}

/** What a task's status reads as: its section, unless it is completed. */
export function stateName(t: TaskRaw): string {
  if (t.completed) return "Completed";
  return homeMembership(t)?.section?.name || "Open";
}

/** A section whose name says the work in it is finished. */
export const DONE_SECTION = /done|complete|closed|shipped/i;

/** Map a task onto the brand palette. Sections are free text, so go by words. */
export function asanaStateColor(completed: boolean, section?: string): string {
  const s = section ?? "";
  if (completed || DONE_SECTION.test(s)) return STATUS_COLOR.done;
  if (/progress|doing|review|working/i.test(s)) return STATUS_COLOR.active;
  return STATUS_COLOR.neutral;
}

// ---------------------------------------------------------------------------
// Name resolution
// ---------------------------------------------------------------------------

/**
 * A user gid for a name or email. "me" is Asana's own alias for the token's
 * owner. An email nobody in the first pages matched is passed through as is:
 * Asana accepts an email where it takes a user, and a large organization can
 * have more people than we list.
 */
export function findUser(users: UserRaw[], want: string): string | undefined {
  const w = (want ?? "").trim().replace(/^@/, "");
  if (!w) return undefined;
  if (/^me$/i.test(w)) return "me";
  const lower = w.toLowerCase();
  const byEmail = users.find((u) => u.email?.toLowerCase() === lower);
  if (byEmail) return byEmail.gid;
  const name = resolveName(w, users.map((u) => u.name ?? "").filter(Boolean));
  const byName = name ? users.find((u) => u.name === name) : undefined;
  if (byName) return byName.gid;
  return w.includes("@") ? w : undefined;
}

/**
 * A listed member's gid, by gid, email or name, and nothing else. A people
 * field stores exactly what it is given, so unlike the assignee there is no
 * "me" and no unlisted email: a value nobody resolved is an error to report.
 */
function findMember(users: UserRaw[], want: string): string | undefined {
  const w = (want ?? "").trim().replace(/^@/, "");
  // "me" is not a name, and fuzzy matching would find it inside "James".
  if (!w || /^me$/i.test(w)) return undefined;
  const lower = w.toLowerCase();
  const hit =
    users.find((u) => u.gid === w) ??
    users.find((u) => u.email?.toLowerCase() === lower) ??
    findByName(users, w);
  return hit?.gid;
}

/** A real calendar date in Asana's `YYYY-MM-DD` form. */
function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Exact (case-insensitive) name first, then resolveName's prefix and substring fallbacks. */
export function findByName<T extends { gid: string; name?: string }>(items: T[], want: string): T | undefined {
  const w = (want ?? "").trim().toLowerCase();
  if (!w) return undefined;
  const exact = items.find((x) => (x.name ?? "").toLowerCase() === w);
  if (exact) return exact;
  const name = resolveName(want, items.map((x) => x.name ?? "").filter(Boolean));
  return name ? items.find((x) => x.name === name) : undefined;
}

/** Names for an error message, capped so a big workspace can't flood the agent. */
export function listNames(names: Array<string | undefined>, max = 40): string {
  const clean = names.filter((n): n is string => !!n);
  if (!clean.length) return "(none)";
  const head = clean.slice(0, max).join(", ");
  return clean.length > max ? `${head} (and ${clean.length - max} more)` : head;
}

export function enabledOptions(f: CustomField): EnumOption[] {
  return (f.enum_options ?? []).filter((o) => o.enabled !== false);
}

/** The project's priority field: an enum custom field named like "Priority". */
function priorityField(fields: CustomField[]): CustomField | undefined {
  return fields.find(
    (f) => /priority/i.test(f.name) && f.resource_subtype === "enum" && enabledOptions(f).length > 0,
  );
}

/**
 * The option of the priority field that means `priority`, by the team's own
 * naming ("High", "P1", "Sev 2"). Asana's stock Priority field stops at High,
 * so an urgent bug lands on the highest option rather than on none at all.
 */
function priorityOption(f: CustomField, priority: TrackerPriority): EnumOption | undefined {
  const options = enabledOptions(f);
  const names = options.map((o) => o.name);
  const name =
    matchPriorityLabel(priority, names) ??
    (priority === "urgent" ? matchPriorityLabel("high", names) : undefined);
  return options.find((o) => o.name === name);
}

function findField(fields: CustomField[], key: string): CustomField | undefined {
  const k = (key ?? "").trim();
  return (
    fields.find((f) => f.gid === k) ??
    fields.find((f) => f.name === k) ??
    fields.find((f) => f.name.toLowerCase() === k.toLowerCase())
  );
}

type FieldValue = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Turn what the agent wrote for a custom field into what Asana takes: an
 * option gid for an enum, a number, `{ date }` for a date, user gids for a
 * people field, and the text itself otherwise.
 */
function customFieldValue(f: CustomField, v: unknown, users: UserRaw[]): FieldValue {
  if (v === null) return { ok: true, value: null };
  const options = enabledOptions(f);
  const option = (want: unknown): EnumOption | undefined => {
    if (typeof want !== "string" && typeof want !== "number") return undefined;
    const s = String(want).trim();
    return options.find((o) => o.gid === s) ?? findByName(options, s);
  };
  const badOption = (want: unknown): FieldValue => ({
    ok: false,
    error: `"${String(want)}" is not an option of "${f.name}". Valid: ${listNames(options.map((o) => o.name))}`,
  });

  switch (f.resource_subtype) {
    case "enum": {
      const o = option(v);
      return o ? { ok: true, value: o.gid } : badOption(v);
    }
    case "multi_enum": {
      const wants = Array.isArray(v) ? v : String(v).split(",");
      const gids: string[] = [];
      for (const w of wants) {
        const o = option(w);
        if (!o) return badOption(w);
        gids.push(o.gid);
      }
      return { ok: true, value: gids };
    }
    case "number": {
      const n = typeof v === "number" ? v : Number(String(v).trim());
      if (String(v).trim() === "" || !Number.isFinite(n)) {
        return { ok: false, error: `"${f.name}" takes a number, not "${String(v)}"` };
      }
      return { ok: true, value: n };
    }
    case "date": {
      // `{ date: "2026-07-01" }` or the bare string; anything else ("next
      // week", a timestamp) is refused rather than guessed at.
      const raw = v && typeof v === "object" && "date" in v ? (v as { date: unknown }).date : v;
      const s = String(raw ?? "").trim();
      if (!isIsoDate(s)) {
        return { ok: false, error: `"${f.name}" takes a date like 2026-07-01, not "${s}"` };
      }
      return { ok: true, value: { date: s } };
    }
    case "people": {
      const wants = Array.isArray(v) ? v : String(v).split(",");
      const gids: string[] = [];
      for (const w of wants) {
        const g = findMember(users, String(w));
        if (!g) {
          return {
            ok: false,
            error: `no workspace member matched "${String(w).trim()}" for "${f.name}". Valid: ${listNames(users.map((u) => u.name))}`,
          };
        }
        gids.push(g);
      }
      return { ok: true, value: Array.from(new Set(gids)) };
    }
    case "text":
      return { ok: true, value: typeof v === "string" ? v : String(v) };
    default:
      return { ok: true, value: v };
  }
}

/**
 * The `custom_fields` object for a create or update: the agent's extraFields
 * (keyed by field gid or name), then priority on top, since a resolved field
 * always wins over a raw one.
 */
export function resolveCustomFields(
  fields: CustomField[],
  extraFields: Record<string, unknown> | undefined,
  priority: TrackerPriority | undefined,
  users: UserRaw[],
): { values: Record<string, unknown>; errors: string[] } {
  const values: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [key, raw] of Object.entries(extraFields ?? {})) {
    const f = findField(fields, key);
    if (!f) {
      errors.push(`Unknown field "${key}". Valid: ${listNames(fields.map((x) => x.name))}.`);
      continue;
    }
    const v = customFieldValue(f, raw, users);
    if (v.ok) values[f.gid] = v.value;
    else errors.push(`${v.error}.`);
  }
  if (priority) {
    const f = priorityField(fields);
    if (!f) {
      errors.push("This project has no Priority field, so priority cannot be set.");
    } else {
      const o = priorityOption(f, priority);
      if (o) values[f.gid] = o.gid;
      else {
        errors.push(
          `No option of "${f.name}" means ${priority}. Valid: ${listNames(enabledOptions(f).map((x) => x.name))}.`,
        );
      }
    }
  }
  return { values, errors };
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** One evidence file once it is attached to the task. */
export type AsanaUploaded = {
  kind: EvidenceKind;
  /** The attachment's gid, which an inline image references. */
  gid: string;
  caption?: string;
  /** A stable link to the attachment (recordings are linked, not inlined). */
  url?: string;
};

// What a markdown line can START with to become something other than text:
// a heading, a list item, a quote, a code fence.
const LEADING_BLOCK_MARKER = /^(?:#{1,6}(?=\s|$)|[-*+>](?=\s|$)|\d{1,9}[.)](?=\s|$)|`{3,}|~{3,}|>)\s*/;

/**
 * A caption is the agent's one line of prose. Written as a markdown line, a
 * caption that happens to start with "1.", "#" or a code fence, is a lone
 * "---", or is bold from end to end, would turn into a list, a heading, a code
 * block, a rule or a heading again. Those markers are dropped (repeatedly, for
 * "> - # x") so the caption always renders as the text it says.
 */
function captionLine(caption?: string): string {
  let c = (caption ?? "").replace(/\s+/g, " ").trim();
  for (let prev = ""; prev !== c; ) {
    prev = c;
    c = c.replace(LEADING_BLOCK_MARKER, "").trim();
  }
  // A caption that is nothing but a rule ("---", "* * *") says nothing.
  if (/^([-*_])(?:\s*\1){2,}$/.test(c)) c = "";
  c = c.replace(/^\*\*(.+)\*\*$/, "$1").trim();
  return c ? `${c}\n` : "";
}

/** The evidence as markdown: each caption directly above its image. */
export function evidenceMarkdown(items: AsanaUploaded[]): string {
  return items
    .map((u) => {
      const cap = captionLine(u.caption);
      if (u.kind === "image") return `${cap}${asanaImage(u.gid)}`;
      // Called a screen recording, whatever produced it.
      const line = u.url
        ? `**Screen recording:** [Watch the screen recording](${u.url})`
        : "**Screen recording:** attached to this task";
      return `${cap}${line}`;
    })
    .join("\n\n");
}

/**
 * Put the evidence under the agent's own Evidence heading when it wrote one,
 * else under a new one at the end. Never two Evidence headings: that is how
 * GitHub tickets once ended up with every caption twice.
 *
 * Asana flattens every heading level to h1/h2, so the agent's Evidence section
 * ends at the NEXT heading of any level, and the images go there rather than
 * after whatever section happens to follow it.
 */
export function withEvidenceSection(markdown: string, evidence: string): string {
  const body = promoteSectionHeadings(markdown ?? "").replace(/\s+$/, "");
  if (!evidence.trim()) return body;
  return placeEvidence(body, evidence, { endAtAnyHeading: true });
}
