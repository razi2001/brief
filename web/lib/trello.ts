import {
  evidenceFileName,
  evidenceIndexes,
  evidenceKind,
  evidenceLabel,
  isPubliclyFetchable,
  placeEvidence,
  promoteSectionHeadings,
  technicalLogsFile,
} from "./ticket-body";
import {
  BRIEF_ATTRIBUTION,
  NO_CAPABILITIES,
  STATUS_COLOR,
  matchPriorityLabel,
  resolveName,
  withBriefAttribution,
  type IssueInput,
  type IssuePatch,
  type IssueSearchResult,
  type LiveIssue,
  type LiveIssueLookup,
  type TargetDetails,
  type Tracker,
  type TrackerPriority,
  type TrackerTarget,
  type UpdateResult,
  type Workspace,
} from "./tracker";
import { chunk } from "./ticket-sync";

/**
 * Trello goes through Brief's own authorization (Trello's token flow, not
 * OAuth 2.0): every request carries the app's API key plus the user's token. A
 * personal key and token pair works exactly the same way.
 */
export type TrelloTok = { key: string; token: string };

const API = "https://api.trello.com/1";

const AUTH_EXPIRED =
  "Your Trello connection has expired - reconnect Trello under Settings, then retry.";

/**
 * Trello rejects a card description longer than this. It is why the technical
 * logs travel as an attachment rather than in the body, and why an overlong
 * report is shortened instead of failing the filing.
 */
export const TRELLO_DESC_LIMIT = 16384;

const PRIORITIES: TrackerPriority[] = ["urgent", "high", "medium", "low"];

/**
 * Trello has no status field: a card's status IS the list it sits in. So the
 * filing target is a BOARD, and the agent's `state` picks the list within it -
 * which makes "file this into Triage" mean exactly what a Trello user expects.
 * This heuristic colors a list name, since Trello itself attaches no meaning.
 */
export function trelloListColor(listName: string): string {
  const n = (listName ?? "").toLowerCase();
  if (/\b(done|complete|completed|closed|shipped|released|archive)\b/.test(n)) {
    return STATUS_COLOR.done;
  }
  if (/\b(doing|in progress|progress|active|review|testing|qa|current)\b/.test(n)) {
    return STATUS_COLOR.active;
  }
  return STATUS_COLOR.neutral;
}

/**
 * Trello card ids are MongoDB ObjectIds, whose first 4 bytes are the creation
 * time in Unix seconds. That is the only creation timestamp the API offers.
 */
export function cardCreatedAt(id: string): string {
  const hex = (id ?? "").slice(0, 8);
  if (!/^[0-9a-f]{8}$/i.test(hex)) return "";
  return new Date(parseInt(hex, 16) * 1000).toISOString();
}

/** Trello has no priority field, so priority only ever exists as a board label. */
function priorityFromLabels(labels: string[]): TrackerPriority | null {
  return PRIORITIES.find((p) => matchPriorityLabel(p, labels) !== undefined) ?? null;
}

function isPriorityLabel(name: string): boolean {
  return PRIORITIES.some((p) => matchPriorityLabel(p, [name]) !== undefined);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** Trello authenticates with key+token as query parameters, not a header. */
function withAuth(tok: TrelloTok, path: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${API}${path}${sep}key=${encodeURIComponent(tok.key)}&token=${encodeURIComponent(tok.token)}`;
}

async function tr(tok: TrelloTok, path: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(withAuth(tok, path), init);
  if (r.status === 401) {
    // Trello also answers 401 when the token is fine but cannot see this one
    // card or board ("unauthorized card permission requested"), and
    // reconnecting would not change that. A token Trello no longer accepts, or
    // one missing a scope ("unauthorized permission requested"), is fixed by
    // reconnecting, so those get the message that says so.
    const text = await r.clone().text().catch(() => "");
    if (!/\b(card|board|list|organization)\s+permission\b/i.test(text)) {
      throw new Error(AUTH_EXPIRED);
    }
  }
  return r;
}

async function trJson<T>(tok: TrelloTok, path: string, init: RequestInit = {}): Promise<T> {
  const r = await tr(tok, path, init);
  // The path never carries the key or token (withAuth adds them to the URL
  // only), so it is safe to put in an error the agent and the logs will see.
  if (!r.ok) throw new Error(`Trello ${path.split("?")[0]} failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

// ---------------------------------------------------------------------------
// Evidence and the description
// ---------------------------------------------------------------------------

type EvidenceFile = IssueInput["evidence"][number];

/**
 * What each evidence file is called on the card. The ticket never exposes how
 * the report was captured, so a file is a numbered "Screenshot" or a "Screen
 * recording", never its original file name. The file itself is uploaded
 * under the hyphenated form of the same name (evidenceFileName).
 */
export function trelloAttachmentNames(evidence: Array<{ contentType: string }>): string[] {
  const indexes = evidenceIndexes(evidence);
  return evidence.map((e, i) => evidenceLabel(e.contentType, indexes[i]));
}

const FENCE = "\n```";
const TRUNCATED = "\n\n(truncated)";
const ATTRIBUTION_TAIL = `\n\n---\n\n${BRIEF_ATTRIBUTION}`;

/**
 * Close a code block left open. An unclosed fence, whether the agent wrote it
 * or a cut landed inside one, turns everything after it into code: the
 * evidence and the attribution included.
 */
function closeOpenFence(md: string): string {
  return (md.match(/^\s{0,3}```/gm) ?? []).length % 2 ? `${md}${FENCE}` : md;
}

/** At most `max` characters, never ending on half of a surrogate pair. */
function trimTo(text: string, max: number): string {
  return text
    .slice(0, Math.max(0, max))
    .replace(/[\uD800-\uDBFF]$/, "")
    .replace(/\s+$/, "");
}

/**
 * A caption that stays on its list line. A newline would end the list item
 * and let the next line become a heading or a block of its own, so all
 * whitespace collapses to single spaces, and a leading # is escaped so it is
 * never read as one either.
 */
function inlineCaption(caption?: string): string {
  return (caption ?? "").replace(/\s+/g, " ").trim().replace(/^#/, "\\#");
}

/**
 * Build the card description.
 *
 * The screenshots themselves are attachments (the first one is the card's
 * cover), so the body carries what the attachments panel cannot: each
 * screenshot's caption, next to the name of the attachment it explains. The
 * rules are the ones GitHub's body learned the hard way:
 *
 *  - Whole-line bold labels become real headings, since Trello renders the
 *    Markdown as written.
 *  - The list goes at the end of the agent's own Evidence section when it
 *    wrote one, never under a second competing heading.
 *  - A recording is linked to its stable hosted copy as well as attached,
 *    because a recording over the board's upload limit (10MB on free Trello)
 *    never makes it onto the card. Only a link anyone can follow, though: a
 *    localhost address in a real ticket goes nowhere.
 *  - The attribution is always last, and the whole thing fits Trello's cap:
 *    when it would not, the agent's prose is shortened, never the evidence or
 *    the attribution.
 */
export function buildTrelloDesc(
  descriptionMarkdown: string,
  evidence: Array<Pick<EvidenceFile, "contentType" | "caption" | "url">>,
): string {
  const names = trelloAttachmentNames(evidence);
  const lines = evidence.map((e, i) => {
    const cap = inlineCaption(e.caption);
    if (evidenceKind(e.contentType) === "image") return cap ? `- ${names[i]}: ${cap}` : `- ${names[i]}`;
    return e.url && isPubliclyFetchable(e.url)
      ? `- ${names[i]}: [Watch the screen recording](${e.url})`
      : `- ${names[i]}`;
  });

  /** The body followed by the evidence, everything but the attribution. */
  const inner = (body: string): string => (lines.length ? placeEvidence(body, lines.join("\n")) : body);

  const body = closeOpenFence(promoteSectionHeadings(descriptionMarkdown ?? "").replace(/\s+$/, ""));
  const full = withBriefAttribution(inner(body));
  if (full.length <= TRELLO_DESC_LIMIT) return full;

  // Everything but the body itself, measured with a body that has no Evidence
  // heading of its own: the worst case, so the shortened body always fits
  // whether or not the agent's heading survived the cut.
  const overhead = withBriefAttribution(inner("x")).length - 1;
  const budget = TRELLO_DESC_LIMIT - overhead - TRUNCATED.length - FENCE.length;
  const cut = budget > 0 ? closeOpenFence(trimTo(body, budget)) + TRUNCATED : "";
  const out = withBriefAttribution(inner(cut));
  if (out.length <= TRELLO_DESC_LIMIT) return out;

  // Only an evidence list longer than the cap on its own gets here. The list
  // is cut instead, and the attribution still ends the description.
  return withBriefAttribution(
    closeOpenFence(trimTo(inner(cut), TRELLO_DESC_LIMIT - ATTRIBUTION_TAIL.length - FENCE.length)),
  );
}

// ---------------------------------------------------------------------------
// Tracker implementation
// ---------------------------------------------------------------------------

type TrList = { id: string; name: string; closed?: boolean };
type TrLabel = { id: string; name: string; color?: string | null };
type TrMember = {
  id: string;
  fullName?: string;
  username?: string;
  avatarUrl?: string | null;
};
type TrBoard = {
  id: string;
  name: string;
  desc?: string;
  url?: string;
  closed?: boolean;
  lists?: TrList[];
};
type TrCard = {
  id: string;
  shortLink?: string;
  name: string;
  desc?: string;
  url: string;
  shortUrl?: string;
  idList?: string;
  idBoard?: string;
  idLabels?: string[];
  idMembers?: string[];
  labels?: TrLabel[];
  members?: TrMember[];
  closed?: boolean;
  dateLastActivity?: string;
  /** Present when card_board / card_list (search) or list=true (a card read) are asked for. */
  board?: { id?: string; name?: string };
  list?: { id?: string; name?: string; closed?: boolean };
};

/** A board's lists/labels/members, loaded once and reused across resolution. */
type BoardMeta = { lists: TrList[]; labels: TrLabel[]; members: TrMember[] };

const EMPTY_META: BoardMeta = { lists: [], labels: [], members: [] };

/** One file headed for the card's attachments, already given its neutral name. */
type Upload = {
  name: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
  image: boolean;
};

/**
 * The card fields the tickets feed needs, read in one request per card. The
 * card's list comes nested (`list=true`) so the feed never reads a board: 30
 * cards on one board used to cost three board requests each time one of those
 * was rate limited.
 */
const LIVE_CARD_QUERY =
  "fields=name,url,shortUrl,shortLink,closed&list=true&list_fields=name,closed" +
  "&members=true&member_fields=fullName,username,avatarUrl";

/**
 * The search request. Exported so the live test replays exactly what the
 * adapter sends: searchIssues swallows every failure, so a request Trello
 * rejects would otherwise look like a search that simply found nothing.
 */
export function trelloSearchPath(query: string, limit: number): string {
  return (
    `/search?query=${encodeURIComponent(query)}&modelTypes=cards&partial=true&cards_limit=${limit}` +
    // card_board and card_list name each card's board and list in the same
    // answer, so the precedent is readable without a request per board.
    `&card_fields=name,url,shortUrl,shortLink,labels&card_board=true&card_list=true&card_members=true`
  );
}

/** The batched live read, exported for the live test for the same reason. */
export function trelloBatchPath(ids: string[]): string {
  // Sub-requests are separated by commas, so a comma INSIDE one (the field
  // lists) is escaped one level deeper than the rest of the URL.
  const urls = ids
    .map((id) => `/cards/${encodeURIComponent(id)}?${LIVE_CARD_QUERY.replace(/,/g, "%2C")}`)
    .join(",");
  return `/batch?urls=${encodeURIComponent(urls)}`;
}

/** One card's answer inside a batch: the card, or the status Trello gave instead. */
type CardRead = { card?: TrCard; status?: number };

/**
 * Read one entry of a /batch answer. Trello keys each sub-response by its HTTP
 * status ({"200": card}, {"404": "..."}); an error object carrying a numeric
 * `statusCode` is read the same way, so either shape still separates "this
 * card was deleted" from "the call failed".
 */
export function parseBatchEntry(entry: unknown): CardRead {
  if (!entry || typeof entry !== "object") return {};
  const e = entry as Record<string, unknown>;
  if (e["200"] && typeof e["200"] === "object") return { card: e["200"] as TrCard };
  const keyed = Object.keys(e).find((k) => /^\d{3}$/.test(k));
  if (keyed) return { status: Number(keyed) };
  if (typeof e.statusCode === "number") return { status: e.statusCode };
  return {};
}

function memberLabel(m: TrMember): string {
  return m.fullName || m.username || m.id;
}

/** Trello's avatarUrl is a base; a size has to be appended to get an image. */
function memberAvatar(m: TrMember): string | undefined {
  return m.avatarUrl ? `${m.avatarUrl}/50.png` : undefined;
}

/**
 * A workspace's logoUrl is a base too, like a member's avatarUrl. One that
 * already names an image file is used as it is.
 */
function workspaceLogo(url?: string | null): string | undefined {
  if (!url) return undefined;
  return /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(url) ? url : `${url.replace(/\/+$/, "")}/170.png`;
}

/** What a batched read came back with: one read per card, or why there are none. */
type BatchOutcome = { reads: CardRead[] } | { status: number };

export function makeTrelloTracker(tok: TrelloTok): Tracker {
  let boardsCache: TrackerTarget[] | null = null;
  const metaCache = new Map<string, BoardMeta>();
  // Flips to false the first time Trello refuses /batch itself (a 400) for
  // this token, so the rest of the sync reads cards one by one instead of
  // paying for a retry it will lose. A rate limit does not flip it: that
  // passes, and the batch is still the cheapest way to read the feed.
  let batchUsable = true;

  async function loadBoards(): Promise<TrackerTarget[]> {
    if (boardsCache) return boardsCache;
    // The open lists come back nested in the same call, so every board carries
    // the states a card can be filed into without one more request per board
    // (Trello allows a token only 100 requests per 10 seconds).
    const boards = await trJson<TrBoard[]>(
      tok,
      `/members/me/boards?filter=open&fields=name,desc,url,closed&lists=open`,
    );
    boardsCache = boards
      .filter((b) => !b.closed)
      .map((b) => ({
        id: b.id,
        key: b.name,
        name: b.name,
        description: b.desc?.trim() || undefined,
        states: (b.lists ?? []).filter((l) => !l.closed).map((l) => l.name),
      }));
    return boardsCache;
  }

  /** A board by id, or by its exact name when the agent passed that instead. */
  async function findBoard(targetId: string): Promise<TrackerTarget> {
    const boards = await loadBoards();
    const want = (targetId ?? "").trim();
    const board =
      boards.find((b) => b.id === want) ??
      boards.find((b) => b.name.toLowerCase() === want.toLowerCase());
    if (!board) {
      throw new Error(
        `Trello: board ${targetId} not found. Known boards: ${boards.map((b) => `${b.name} (id: ${b.id})`).join(", ")}`,
      );
    }
    return board;
  }

  async function boardMeta(boardId: string): Promise<BoardMeta> {
    const cached = metaCache.get(boardId);
    if (cached) return cached;
    const id = encodeURIComponent(boardId);
    // The lists are where a card lives, so failing to read them is the
    // caller's problem to report. Labels and members only refine a filing.
    const [lists, labels, members] = await Promise.all([
      trJson<TrList[]>(tok, `/boards/${id}/lists?filter=open&fields=name`),
      trJson<TrLabel[]>(tok, `/boards/${id}/labels?fields=name,color&limit=1000`).catch(() => null),
      trJson<TrMember[]>(tok, `/boards/${id}/members?fields=fullName,username`).catch(() => null),
    ]);
    // Trello ships every board with six unnamed colour labels; they are noise
    // to an agent choosing labels by meaning, so only named ones are offered.
    const meta: BoardMeta = {
      lists,
      labels: (labels ?? []).filter((l) => l.name?.trim()),
      members: members ?? [],
    };
    // A partial answer (rate limited, say) serves this call but is not cached,
    // or every later call would see a board with no labels or members at all.
    if (labels && members) metaCache.set(boardId, meta);
    return meta;
  }

  /**
   * The list a new card should land in: the agent's `state`, else the first.
   * `matched` is false only when a state was asked for and no list answered
   * to it, which is the one case worth a warning.
   */
  function pickList(meta: BoardMeta, state?: string): { list: TrList; matched: boolean } | undefined {
    if (!meta.lists.length) return undefined;
    if (!state?.trim()) return { list: meta.lists[0], matched: true };
    const canonical = resolveName(
      state,
      meta.lists.map((l) => l.name),
    );
    const hit = meta.lists.find((l) => l.name === canonical);
    return hit ? { list: hit, matched: true } : { list: meta.lists[0], matched: false };
  }

  /**
   * Set the card's priority label among `ids`: a swap, not an add, since a
   * card marked both P1 and P3 tells nobody anything. Undefined when the board
   * has no label for that priority.
   */
  function withPriorityLabel(
    meta: BoardMeta,
    ids: string[],
    priority: TrackerPriority,
  ): string[] | undefined {
    const plabel = matchPriorityLabel(
      priority,
      meta.labels.map((l) => l.name),
    );
    const hit = meta.labels.find((l) => l.name === plabel);
    if (!hit) return undefined;
    const priorityIds = new Set(meta.labels.filter((l) => isPriorityLabel(l.name)).map((l) => l.id));
    return [...ids.filter((x) => !priorityIds.has(x)), hit.id];
  }

  /** Card fields the agent set through extraFields (e.g. `due`, `pos`). */
  function primitiveExtras(extra?: Record<string, unknown>): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(extra ?? {})) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    }
    return out;
  }

  /** Upload one attachment. Best-effort: the card already exists. */
  async function attach(cardId: string, u: Upload, setCover: boolean): Promise<boolean> {
    try {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(u.bytes)], { type: u.contentType }), u.filename);
      const q = new URLSearchParams({
        name: u.name,
        mimeType: u.contentType,
        setCover: String(setCover),
      });
      const r = await tr(tok, `/cards/${cardId}/attachments?${q.toString()}`, {
        method: "POST",
        body: form,
      });
      if (!r.ok) {
        console.warn(`[trello-tracker] attachment "${u.name}" failed: ${r.status}`);
        return false;
      }
      return true;
    } catch (err) {
      console.warn(`[trello-tracker] attachment "${u.name}" failed:`, err);
      return false;
    }
  }

  async function readCardsBatch(ids: string[]): Promise<BatchOutcome> {
    try {
      const r = await tr(tok, trelloBatchPath(ids));
      if (!r.ok) return { status: r.status };
      const results = (await r.json()) as unknown;
      // An answer that does not line up one entry per card cannot say which
      // card is which, so none of it is trusted.
      if (!Array.isArray(results) || results.length !== ids.length) return { status: 0 };
      return { reads: results.map(parseBatchEntry) };
    } catch {
      return { status: 0 };
    }
  }

  async function readCard(id: string): Promise<CardRead> {
    try {
      const r = await tr(tok, `/cards/${encodeURIComponent(id)}?${LIVE_CARD_QUERY}`);
      if (r.ok) return { card: (await r.json()) as TrCard };
      return { status: r.status };
    } catch {
      return {};
    }
  }

  return {
    kind: "trello",
    targetNoun: "board",
    capabilities: {
      ...NO_CAPABILITIES,
      labels: true,
      comments: true,
      nativeAttachments: true,
      // The list within the board is the state. Trello has no priority field,
      // but an existing board label can carry one, so it stays offered.
      states: true,
      priority: true,
    },
    bodyGuidance:
      "The description is Markdown, which Trello renders natively. Section labels you write on their own line become real headings. A card has no status field of its own: the LIST it is filed into is its status, so set `state` to the name of the list it belongs in. Screenshots are attached to the card and the first becomes its cover image.",

    async listTargets() {
      return loadBoards();
    },

    async searchIssues(query, opts): Promise<IssueSearchResult[]> {
      const q = query.trim();
      if (!q) return [];
      try {
        const limit = Math.min(Math.max(opts?.limit ?? 15, 1), 50);
        const j = await trJson<{ cards?: TrCard[] }>(tok, trelloSearchPath(q, limit));
        return (j.cards ?? []).map((c) => {
          const labels = (c.labels ?? []).map((l) => l.name).filter(Boolean);
          return {
            identifier: c.shortLink ?? c.id,
            title: c.name,
            url: c.shortUrl ?? c.url ?? "",
            target: c.board?.name ?? "",
            // A Trello card's list IS its status.
            state: c.list?.name,
            labels,
            assignee: c.members?.[0] ? memberLabel(c.members[0]) : undefined,
            priority: priorityFromLabels(labels) ?? undefined,
          };
        });
      } catch {
        return [];
      }
    },

    async getTargetDetails(targetId): Promise<TargetDetails> {
      const board = await findBoard(targetId);
      const meta = await boardMeta(board.id);
      return {
        id: board.id,
        key: board.key,
        name: board.name,
        description: board.description,
        // The board's lists, presented as the states a card can be filed into.
        states: meta.lists.map((l) => l.name),
        labels: meta.labels.map((l) => l.name),
        members: meta.members.map(memberLabel),
      };
    },

    async fileIssue({
      targetId,
      title,
      descriptionMarkdown,
      labels,
      priority,
      state,
      assignee,
      comment,
      extraFields,
      evidence,
      details,
    }) {
      const board = await findBoard(targetId);
      const meta = await boardMeta(board.id);
      const picked = pickList(meta, state);
      if (!picked) {
        throw new Error(
          `Trello: board ${board.name} has no open lists - a card needs a list to live in.`,
        );
      }
      const { list } = picked;
      if (!picked.matched) {
        console.warn(`[trello-tracker] no list matched "${state}"; using the first list, "${list.name}"`);
      }

      const labelNames = meta.labels.map((l) => l.name);
      // Only labels the board already has. Unknown ones are skipped, never
      // created, so a typo cannot add a stray label to the team's board.
      let idLabels = (labels ?? [])
        .map((want) => meta.labels.find((l) => l.name === resolveName(want, labelNames))?.id)
        .filter((id): id is string => !!id);
      // No priority field on a card: adopt the board's own label convention,
      // replacing any other priority label the agent also listed. A board with
      // no matching label simply gets none.
      if (priority) idLabels = withPriorityLabel(meta, idLabels, priority) ?? idLabels;
      idLabels = Array.from(new Set(idLabels));

      let idMember: string | undefined;
      if (assignee) {
        const canonical = resolveName(assignee.replace(/^@/, ""), meta.members.map(memberLabel));
        const hit =
          meta.members.find((m) => memberLabel(m) === canonical) ??
          meta.members.find((m) => m.username?.toLowerCase() === assignee.replace(/^@/, "").toLowerCase());
        if (hit) idMember = hit.id;
        else console.warn(`[trello-tracker] no member matched assignee "${assignee}"`);
      }

      // A JSON body rather than query parameters: the description can run to
      // 16k characters, far past what a URL can safely carry. Fields the agent
      // set through extraFields go first, so the resolved ones always win.
      const card = await trJson<TrCard>(tok, `/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...primitiveExtras(extraFields),
          idList: list.id,
          name: title,
          desc: buildTrelloDesc(descriptionMarkdown, evidence),
          ...(idLabels.length ? { idLabels: idLabels.join(",") } : {}),
          ...(idMember ? { idMembers: idMember } : {}),
        }),
      });

      // Every attachment goes through one path: the evidence in order, then
      // the technical logs last, so the first screenshot is the one that
      // becomes the cover and the board shows it without opening the card.
      const names = trelloAttachmentNames(evidence);
      const indexes = evidenceIndexes(evidence);
      const uploads: Upload[] = evidence.map((e, i) => ({
        name: names[i],
        // Trello shows the file name in the download link, so it is the
        // neutral one too.
        filename: evidenceFileName(e.contentType, indexes[i]),
        contentType: e.contentType,
        bytes: e.bytes,
        image: evidenceKind(e.contentType) === "image",
      }));
      // The logs travel as a file because the network and console logs of a
      // single recording can outgrow the 16k description cap on their own.
      const logs = technicalLogsFile(details);
      if (logs) uploads.push({ name: "Technical logs", ...logs, image: false });
      let coverSet = false;
      for (const u of uploads) {
        // Only the first screenshot asks to be the cover. If its upload fails,
        // the next screenshot asks instead, so the card still gets one.
        const cover = u.image && !coverSet;
        const ok = await attach(card.id, u, cover);
        if (ok && cover) coverSet = true;
      }

      if (comment?.trim()) {
        try {
          // In the body, like the description: a comment can be long, and the
          // query string is no place for it.
          const r = await tr(tok, `/cards/${card.id}/actions/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: comment.trim() }),
          });
          if (!r.ok) console.warn(`[trello-tracker] comment failed: ${r.status}`);
        } catch (err) {
          console.warn("[trello-tracker] comment post failed:", err);
        }
      }

      return {
        id: card.id,
        identifier: card.shortLink ?? card.id,
        url: card.shortUrl ?? card.url,
        title: card.name,
      };
    },

    async updateIssue(identifier, patch: IssuePatch): Promise<UpdateResult> {
      try {
        const id = encodeURIComponent((identifier ?? "").trim());
        const card = await trJson<TrCard>(tok, `/cards/${id}?fields=name,idList,idBoard,idLabels`);
        const boardId = card.idBoard;
        if (!boardId) return { ok: false, error: `card ${identifier} has no board` };
        const meta = await boardMeta(boardId);
        const labelNames = meta.labels.map((l) => l.name);

        // Fields the agent set through extraFields go first, so the resolved
        // ones below always win.
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(primitiveExtras(patch.extraFields))) {
          params.set(k, String(v));
        }
        if (patch.title) params.set("name", patch.title);

        if (patch.state) {
          const canonical = resolveName(
            patch.state,
            meta.lists.map((l) => l.name),
          );
          const list = meta.lists.find((l) => l.name === canonical);
          if (!list) {
            return {
              ok: false,
              error: `list "${patch.state}" not found on this board. A Trello card's status is its list; valid lists: ${meta.lists.map((l) => l.name).join(", ")}`,
            };
          }
          params.set("idList", list.id);
        }

        if (patch.labels?.length || patch.priority) {
          let ids: string[];
          if (patch.labels?.length) {
            ids = [];
            const missing: string[] = [];
            for (const want of patch.labels) {
              const hit = meta.labels.find((l) => l.name === resolveName(want, labelNames));
              if (hit) ids.push(hit.id);
              else missing.push(want);
            }
            if (missing.length) {
              return {
                ok: false,
                error: `labels not found: ${missing.join(", ")}. Valid labels: ${labelNames.join(", ")}`,
              };
            }
          } else {
            // A priority-only change keeps the card's other labels: idLabels
            // REPLACES the set, so starting from nothing would wipe them.
            ids = [...(card.idLabels ?? [])];
          }
          if (patch.priority) {
            const swapped = withPriorityLabel(meta, ids, patch.priority);
            if (!swapped) {
              return {
                ok: false,
                error: `this board has no label matching priority "${patch.priority}" (Trello cards have no priority field). Existing labels: ${labelNames.join(", ")}`,
              };
            }
            ids = swapped;
          }
          params.set("idLabels", Array.from(new Set(ids)).join(","));
        }

        if (patch.assignee) {
          const want = patch.assignee.replace(/^@/, "");
          const canonical = resolveName(want, meta.members.map(memberLabel));
          const hit =
            meta.members.find((m) => memberLabel(m) === canonical) ??
            meta.members.find((m) => m.username?.toLowerCase() === want.toLowerCase());
          if (!hit) {
            return {
              ok: false,
              error: `member "${patch.assignee}" is not on this board. Valid members: ${meta.members.map(memberLabel).join(", ")}`,
            };
          }
          params.set("idMembers", hit.id);
        }

        if (![...params.keys()].length) return { ok: false, error: "nothing to update" };
        const r = await tr(tok, `/cards/${id}?${params.toString()}`, { method: "PUT" });
        if (!r.ok) return { ok: false, error: `Trello update failed: ${r.status} ${await r.text()}` };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    async getIssue(identifier) {
      const id = encodeURIComponent((identifier ?? "").trim());
      const card = await trJson<TrCard>(
        tok,
        `/cards/${id}?fields=name,url,shortUrl,shortLink,idList,idBoard,labels,closed&members=true&member_fields=fullName,username`,
      );
      const meta = card.idBoard ? await boardMeta(card.idBoard) : EMPTY_META;
      const listName = meta.lists.find((l) => l.id === card.idList)?.name ?? "";
      const members = card.members ?? [];
      const labels = (card.labels ?? []).map((l) => l.name).filter(Boolean);
      return {
        identifier: card.shortLink ?? card.id,
        title: card.name,
        url: card.shortUrl ?? card.url,
        // The list is the status - reported as `state` so the agent's verify
        // step checks the same thing it set.
        state: listName,
        stateColor: trelloListColor(listName),
        assignee: members[0] ? memberLabel(members[0]) : null,
        labels,
        priority: priorityFromLabels(labels),
        archived: !!card.closed,
      };
    },

    async getLiveIssues(identifiers): Promise<LiveIssueLookup> {
      const issues: Record<string, LiveIssue> = {};
      const gone: string[] = [];
      const ids = Array.from(new Set(identifiers.filter(Boolean)));
      if (!ids.length) return { issues, gone };

      // Trello's /batch runs up to 10 GETs in one round trip and reports each
      // one's status separately, which is exactly what separates "this card
      // was deleted" from "the call failed". When a batch fails, the same
      // chunk is read card by card, so the feed never freezes on it.
      for (const batch of chunk(ids, 10)) {
        let reads: CardRead[] | null = null;
        if (batchUsable) {
          const outcome = await readCardsBatch(batch);
          if ("reads" in outcome) reads = outcome.reads;
          // Rate limited: every further request in this render would be
          // refused too, and each refusal keeps the limit in force. Stop, and
          // leave the remaining cards on their snapshots.
          else if (outcome.status === 429) break;
          // A 400 is Trello refusing /batch itself for this token, which will
          // not change before the sync ends.
          else if (outcome.status === 400) batchUsable = false;
        }
        if (!reads) reads = await Promise.all(batch.map((id) => readCard(id)));

        let rateLimited = false;
        for (let i = 0; i < batch.length; i++) {
          const { card, status } = reads[i];
          if (!card) {
            // Only a 404 is Trello saying the card no longer exists. A 401 is
            // a board the token lost access to, and anything else is a failed
            // read; both leave the row on its snapshot.
            if (status === 404) gone.push(batch[i]);
            if (status === 429) rateLimited = true;
            continue;
          }
          // The list comes nested in the card, so no board is read here.
          const listName = card.list?.name ?? "";
          // An archived card, or one in an archived list, has left the board,
          // which teams use for "done".
          const archived = !!card.closed || !!card.list?.closed;
          const member = card.members?.[0];
          issues[batch[i]] = {
            identifier: card.shortLink ?? card.id,
            title: card.name ?? "",
            url: card.shortUrl ?? card.url ?? "",
            stateName: archived ? "Archived" : listName,
            stateColor: archived ? STATUS_COLOR.done : trelloListColor(listName),
            // Trello exposes no creation timestamp on a card; its id encodes one.
            createdAt: cardCreatedAt(card.id),
            assignee: member ? { name: memberLabel(member), avatarUrl: memberAvatar(member) } : undefined,
          };
        }
        if (rateLimited) break;
      }
      return { issues, gone };
    },
  };
}

/**
 * The Trello workspaces this token can see, for the workspace pick on
 * Settings. Best-effort: an empty list rather than an error, so a Trello
 * outage leaves the picker empty instead of breaking the page.
 */
export async function listTrelloWorkspaces(tok: TrelloTok): Promise<Workspace[]> {
  try {
    const orgs = await trJson<
      Array<{ id?: string; displayName?: string; logoUrl?: string | null }>
    >(tok, `/members/me/organizations?fields=id,displayName,logoUrl`);
    if (!Array.isArray(orgs)) return [];
    return orgs
      .filter((o): o is { id: string; displayName?: string; logoUrl?: string | null } => !!o?.id)
      .map((o) => ({
        id: o.id,
        name: o.displayName || o.id,
        avatarUrl: workspaceLogo(o.logoUrl),
      }));
  } catch {
    return [];
  }
}
