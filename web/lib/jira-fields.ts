/**
 * Jira create-screen fields: what a project requires and what each field
 * accepts. Pure, unit-tested in jira-fields.test.ts.
 *
 * Projects often REQUIRE custom fields (Story Points, Components...). Jira
 * only takes them in an exact shape (a number, `[{ "id": ... }]`), so a value
 * the agent sends as plain text is rejected and the ticket never files. These
 * helpers put each value in the shape Jira wants, and name exactly what is
 * still missing when a required field can't be filled.
 */

export interface JiraAllowedValue {
  id?: string;
  name?: string;
  value?: string;
}

export interface JiraFieldMeta {
  fieldId: string;
  name: string;
  required: boolean;
  hasDefaultValue?: boolean;
  schema?: { type?: string; items?: string; system?: string; custom?: string };
  allowedValues?: JiraAllowedValue[];
}

/** Raw createmeta field, as either createmeta endpoint returns it. */
type RawField = {
  fieldId?: string;
  key?: string;
  name?: string;
  required?: boolean;
  hasDefaultValue?: boolean;
  schema?: JiraFieldMeta["schema"];
  allowedValues?: JiraAllowedValue[];
};

/** Normalize `fields` from createmeta: an object keyed by id, or an array. */
export function toFieldMeta(fields: unknown): JiraFieldMeta[] {
  const entries: Array<[string, RawField]> = Array.isArray(fields)
    ? (fields as RawField[]).map((f) => [f.fieldId ?? f.key ?? "", f])
    : Object.entries((fields ?? {}) as Record<string, RawField>);
  return entries
    .filter(([id]) => !!id)
    .map(([id, f]) => ({
      fieldId: id,
      name: f.name || id,
      required: !!f.required,
      hasDefaultValue: !!f.hasDefaultValue,
      schema: f.schema,
      allowedValues: Array.isArray(f.allowedValues) ? f.allowedValues : undefined,
    }));
}

// Set by Brief itself on every ticket, or by Jira: never "missing".
const SET_BY_BRIEF = new Set(["summary", "description", "issuetype", "project", "reporter", "attachment"]);

const labelOf = (a: JiraAllowedValue) => a.name ?? a.value ?? a.id ?? "";

function asList(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [v];
}

/** The text a value stands for: "Web", 3, {name: "Web"}, {value: "Prod"}, {id: "1"}. */
function textOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v).trim();
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return textOf(o.name ?? o.value ?? o.id ?? "");
  }
  return "";
}

function findAllowed(meta: JiraFieldMeta, text: string): JiraAllowedValue | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  return (meta.allowedValues ?? []).find(
    (a) => a.id === text.trim() || (a.name ?? "").toLowerCase() === t || (a.value ?? "").toLowerCase() === t,
  );
}

/** The allowed values as people read them, for messages. */
export function allowedList(meta: JiraFieldMeta, max = 8): string {
  const all = (meta.allowedValues ?? []).map(labelOf).filter(Boolean);
  return all.slice(0, max).join(", ") + (all.length > max ? `, and ${all.length - max} more` : "");
}

/** How a person should fill a field: "Story Points (a number)". */
export function describeField(meta: JiraFieldMeta): string {
  if (meta.schema?.type === "number") return `${meta.name} (a number)`;
  if (meta.allowedValues?.length) return `${meta.name} (one of: ${allowedList(meta)})`;
  return meta.name;
}

/** Jira wants an allowed value by id; options without an id by value. */
function refTo(a: JiraAllowedValue): Record<string, string> {
  if (a.id) return { id: a.id };
  if (a.value) return { value: a.value };
  return { name: a.name ?? "" };
}

/**
 * Put the agent's extra fields in the shape Jira takes, matched to the
 * project's fields by id or by name. Returns the fields Jira will accept and
 * one problem line per value that can't be made valid (that field is dropped).
 * A key the project doesn't list passes through untouched.
 */
export function coerceJiraFields(
  extra: Record<string, unknown>,
  meta: JiraFieldMeta[],
): { fields: Record<string, unknown>; problems: string[] } {
  const fields: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const [key, value] of Object.entries(extra)) {
    const m =
      meta.find((f) => f.fieldId === key) ?? meta.find((f) => f.name.toLowerCase() === key.trim().toLowerCase());
    if (!m) {
      fields[key] = value;
      continue;
    }
    const type = m.schema?.type;
    if (type === "number") {
      const raw = typeof value === "number" ? value : parseFloat(textOf(asList(value)[0]).replace(",", "."));
      if (Number.isFinite(raw)) fields[m.fieldId] = raw;
      else problems.push(`${m.name} must be a number, got "${textOf(value)}"`);
      continue;
    }
    if (m.allowedValues?.length && (type === "array" || type === "option" || type === "priority")) {
      const wanted = type === "array" ? asList(value) : [asList(value)[0]];
      const refs: Record<string, string>[] = [];
      for (const w of wanted) {
        const hit = findAllowed(m, textOf(w));
        if (hit) refs.push(refTo(hit));
        else problems.push(`${m.name}: "${textOf(w)}" isn't one of ${allowedList(m)}`);
      }
      if (refs.length) fields[m.fieldId] = type === "array" ? refs : refs[0];
      continue;
    }
    if (type === "string" && typeof value !== "string") {
      fields[m.fieldId] = textOf(value);
      continue;
    }
    fields[m.fieldId] = value;
  }
  return { fields, problems };
}

/**
 * The required fields `fields` leaves empty. A required field with exactly one
 * allowed value is filled with it (there's no choice to make); the rest are
 * returned as missing.
 */
export function fillRequired(
  fields: Record<string, unknown>,
  meta: JiraFieldMeta[],
): { fields: Record<string, unknown>; missing: JiraFieldMeta[] } {
  const out = { ...fields };
  const missing: JiraFieldMeta[] = [];
  for (const m of meta) {
    if (!m.required || m.hasDefaultValue || SET_BY_BRIEF.has(m.fieldId)) continue;
    const v = out[m.fieldId];
    if (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0) && v !== "") continue;
    if (m.allowedValues?.length === 1) {
      const ref = refTo(m.allowedValues[0]);
      out[m.fieldId] = m.schema?.type === "array" ? [ref] : ref;
      continue;
    }
    missing.push(m);
  }
  return { fields: out, missing };
}

/** An example guidance line for the missing fields: "Story Points: 1, Components: Web". */
function exampleFor(missing: JiraFieldMeta[]): string {
  return missing
    .map((m) => {
      if (m.schema?.type === "number") return `${m.name}: 1`;
      const first = m.allowedValues?.map(labelOf).find(Boolean);
      return `${m.name}: ${first ?? "..."}`;
    })
    .join(", ");
}

/**
 * Said to the agent (so it can set the fields and retry) and, if it never
 * manages to, to the person who filed: names every field and what it takes.
 */
export function missingFieldsMessage(projectKey: string, missing: JiraFieldMeta[], problems: string[] = []): string {
  const one = missing.length === 1;
  const list = missing.map(describeField).join("; ");
  const why = problems.length ? ` (${problems.join("; ")})` : "";
  return (
    `Jira project ${projectKey} requires ${list}${why}. ` +
    `Set ${one ? "it" : "them"} with create_issue's custom_fields, or add ${one ? "it" : "them"} to your ticket guidance ` +
    `(for example "${exampleFor(missing)}") and retry.`
  );
}

/**
 * Jira's 400 body turned into one sentence, with field ids replaced by their
 * names: "Jira rejected the ticket in EWO: Story Points: Operation value must
 * be a number."
 */
export function rejectionMessage(projectKey: string, body: string, meta: JiraFieldMeta[]): string {
  let parsed: { errorMessages?: string[]; errors?: Record<string, string> } = {};
  try {
    parsed = JSON.parse(body);
  } catch {
    /* not JSON: show it as is */
  }
  const nameOf = (id: string) => meta.find((m) => m.fieldId === id)?.name ?? id;
  const parts = [
    ...(parsed.errorMessages ?? []),
    ...Object.entries(parsed.errors ?? {}).map(([id, msg]) => {
      const m = meta.find((f) => f.fieldId === id);
      const hint = m?.allowedValues?.length ? ` (allowed: ${allowedList(m)})` : "";
      return msg.toLowerCase().startsWith(nameOf(id).toLowerCase()) ? `${msg}${hint}` : `${nameOf(id)}: ${msg}${hint}`;
    }),
  ].filter(Boolean);
  const detail = parts.length ? parts.join("; ") : body.slice(0, 300);
  return `Jira rejected the ticket in project ${projectKey}: ${detail}`;
}
