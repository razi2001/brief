// Pure helper: turn an attached instant replay (replay.json, rrweb events
// recorded by the extension) into plain steps the filing agent can read - the
// pages visited, what was clicked, which fields were typed into. Typed values
// were masked at capture time and never appear here. No IO; unit-tested.

export interface ReplayChip {
  label: string;
  url?: string | null;
  title?: string | null;
  recorded: boolean;
  a: number; // ms from the replay start
  b: number;
}

// The slice of rrweb's event shape this reads.
export interface RrEvent {
  type: number;
  timestamp: number;
  data?: {
    href?: string;
    node?: Node;
    source?: number;
    type?: number;
    id?: number;
    isChecked?: boolean;
    text?: string; // an input's value - masked at capture, never read here
    adds?: Array<{ parentId: number; node: Node }>;
  };
}

export interface ReplayFile {
  v?: number;
  events: RrEvent[];
  chips?: ReplayChip[];
  durationMs?: number;
}

export interface ReplaySummary {
  durationMs: number;
  sites: string[];
  steps: string[];
  /** The reporter's voice-over on the replay, transcribed (set by run-processing). */
  narration?: string;
}

// rrweb constants
const FULL = 2;
const INCREMENTAL = 3;
const META = 4;
const SRC_MUTATION = 0;
const SRC_MOUSE = 2;
const SRC_INPUT = 5;
const CLICK = 2;
const ELEMENT = 2;
const TEXT = 3;

export interface Node {
  id: number;
  type: number;
  tagName?: string;
  attributes?: Record<string, unknown>;
  textContent?: string;
  childNodes?: Node[];
}

const ACTIONABLE = new Set(["a", "button", "input", "select", "textarea", "label", "summary", "option"]);
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function summarizeReplay(file: ReplayFile, maxSteps = 40): ReplaySummary {
  const events = Array.isArray(file?.events) ? file.events : [];
  const chips = Array.isArray(file?.chips) ? file.chips : [];
  const t0 = events[0]?.timestamp ?? 0;
  const nodes = new Map<number, Node>();
  const parent = new Map<number, number>();

  const index = (n: Node, p?: number) => {
    if (!n || typeof n.id !== "number") return;
    nodes.set(n.id, n);
    if (p != null) parent.set(n.id, p);
    for (const c of n.childNodes ?? []) index(c, n.id);
  };
  const text = (n: Node, depth = 0): string => {
    if (!n || depth > 6) return "";
    if (n.type === TEXT) return n.textContent ?? "";
    return (n.childNodes ?? []).map((c) => text(c, depth + 1)).join(" ");
  };
  const attr = (n: Node, k: string) => {
    const v = n.attributes?.[k];
    return typeof v === "string" ? v.trim() : "";
  };
  const describe = (n: Node): string => {
    const tag = (n.tagName ?? "").toLowerCase();
    const label =
      attr(n, "aria-label") ||
      text(n).replace(/\s+/g, " ").trim() ||
      attr(n, "placeholder") ||
      attr(n, "title") ||
      attr(n, "alt") ||
      attr(n, "name") ||
      (tag === "input" && /^(submit|button)$/i.test(attr(n, "type")) ? attr(n, "value") : "") ||
      attr(n, "id");
    return label ? `"${clip(label)}"` : `a ${tag || "element"}`;
  };
  // A click usually lands on an icon or a span inside the real control.
  const target = (id: number): Node | undefined => {
    let cur = nodes.get(id);
    for (let i = 0; cur && i < 4; i++) {
      const tag = (cur.tagName ?? "").toLowerCase();
      if (ACTIONABLE.has(tag) || attr(cur, "role") === "button" || attr(cur, "role") === "link") return cur;
      const p = parent.get(cur.id);
      cur = p != null ? nodes.get(p) : undefined;
    }
    return nodes.get(id);
  };

  const steps: Array<{ t: number; s: string }> = [];
  let lastHref = "";
  let lastInput = -1;
  for (const e of events) {
    const t = (e?.timestamp ?? t0) - t0;
    if (e?.type === META) {
      const href = String(e.data?.href ?? "");
      if (href && href !== lastHref) steps.push({ t, s: `Opened ${href}` });
      lastHref = href;
      lastInput = -1;
    } else if (e?.type === FULL) {
      nodes.clear();
      parent.clear();
      if (e.data?.node) index(e.data.node);
    } else if (e?.type === INCREMENTAL) {
      const d = e.data ?? {};
      if (d.source === SRC_MUTATION) {
        for (const add of d.adds ?? []) index(add.node, add.parentId);
      } else if (d.source === SRC_MOUSE && d.type === CLICK && d.id != null) {
        const n = target(d.id);
        if (n && n.type === ELEMENT) steps.push({ t, s: `Clicked ${describe(n)}` });
        lastInput = -1;
      } else if (d.source === SRC_INPUT && d.id != null && d.id !== lastInput) {
        const n = nodes.get(d.id);
        if (n) {
          const kind = attr(n, "type").toLowerCase();
          if (typeof d.isChecked === "boolean" && /checkbox|radio/.test(kind)) {
            steps.push({ t, s: `${d.isChecked ? "Checked" : "Unchecked"} ${describe(n)}` });
          } else {
            steps.push({ t, s: `Typed into ${describe(n)}` });
          }
        }
        lastInput = d.id;
      }
    }
  }
  for (const c of chips) {
    if (!c.recorded) steps.push({ t: c.a, s: "Switched to a tab that is not recorded" });
  }
  steps.sort((x, y) => x.t - y.t);

  const lines = steps.map((x) => `${clock(x.t)} ${x.s}`);
  const kept = lines.length > maxSteps ? [...lines.slice(0, 5), "…", ...lines.slice(-(maxSteps - 6))] : lines;
  return {
    durationMs: file?.durationMs ?? (events.length ? events[events.length - 1].timestamp - t0 : 0),
    sites: [...new Set(chips.filter((c) => c.recorded).map((c) => c.label))],
    steps: kept,
  };
}
