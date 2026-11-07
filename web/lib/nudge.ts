/**
 * The extension's "Seen a bug?" card, as the owner sets it on /admin/card.
 * Pure: the defaults, the caps and the answer GET /api/nudge sends.
 * The extension keeps its own copy of the defaults (content.js).
 */

export const DEFAULT_MESSAGE = "Seen a bug?";
export const DEFAULT_BUTTON = "Brief it";
export const MAX_MESSAGE = 80;
export const MAX_BUTTON = 24;
/** A push older than this is ignored, so a browser paired later doesn't get it. */
export const PUSH_TTL_MS = 3 * 86_400_000;

export type NudgeText = { message: string; button: string };
export type NudgePush = { id: string; at: string };
export type NudgeAnswer = NudgeText & { push: NudgePush | null };

/** One line, trimmed, capped. Anything that isn't a string is empty. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

/** What the owner saved, empty fields falling back to the built-in text. */
export function effectiveText(saved: Partial<NudgeText> | null | undefined): NudgeText {
  return {
    message: cleanText(saved?.message, MAX_MESSAGE) || DEFAULT_MESSAGE,
    button: cleanText(saved?.button, MAX_BUTTON) || DEFAULT_BUTTON,
  };
}

/** The saved text from a PUT body, or null when it isn't one. Empty is allowed (back to the default). */
export function parseText(body: unknown): NudgeText | null {
  if (!body || typeof body !== "object") return null;
  const { message, button } = body as Record<string, unknown>;
  if ((message !== undefined && typeof message !== "string") || (button !== undefined && typeof button !== "string")) {
    return null;
  }
  return { message: cleanText(message, MAX_MESSAGE), button: cleanText(button, MAX_BUTTON) };
}

/** A Clerk user id: letters, digits, _ and - only. */
export function isUserId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);
}

/** The newest push still worth showing, or null. */
export function livePush(push: NudgePush | null | undefined, now: number): NudgePush | null {
  if (!push) return null;
  const at = Date.parse(push.at);
  return Number.isFinite(at) && now - at < PUSH_TTL_MS ? push : null;
}

/** What a person did with the owner's last push, furthest first. */
export type CardStatus = "briefed" | "closed" | "shown" | "sent";
const RANK: Record<string, number> = { "nudge.brief_it": 3, "nudge.closed": 2, "nudge.shown": 1 };
const STATUS = ["sent", "shown", "closed", "briefed"] as const;

export type PushRow = { id: string; user_id: string | null; created_at: string };
export type CardEventRow = { user_id: string; name: string; push: string };

/**
 * Per person: their newest push (sent to them, or to everyone) and the
 * furthest thing they did with it. Everyone's newest push: how many did what.
 */
export function cardStatuses(
  pushes: PushRow[],
  events: CardEventRow[],
  userIds: string[],
): {
  people: Record<string, { at: string; status: CardStatus }>;
  everyone: { at: string; shown: number; closed: number; briefed: number } | null;
} {
  const newest = (rows: PushRow[]) => rows.reduce<PushRow | null>((a, r) => (!a || r.created_at > a.created_at ? r : a), null);
  const all = newest(pushes.filter((p) => p.user_id === null));
  const done = new Map<string, number>(); // `${push}|${user}` → rank
  for (const e of events) {
    const k = `${e.push}|${e.user_id}`;
    done.set(k, Math.max(done.get(k) ?? 0, RANK[e.name] ?? 0));
  }
  const people: Record<string, { at: string; status: CardStatus }> = {};
  for (const id of userIds) {
    const own = newest(pushes.filter((p) => p.user_id === id));
    const p = !own ? all : !all ? own : own.created_at > all.created_at ? own : all;
    if (p) people[id] = { at: p.created_at, status: STATUS[done.get(`${p.id}|${id}`) ?? 0] };
  }
  let everyone = null;
  if (all) {
    const ranks = [...done.entries()].filter(([k]) => k.startsWith(`${all.id}|`)).map(([, r]) => r);
    everyone = {
      at: all.created_at,
      shown: ranks.filter((r) => r >= 1).length,
      closed: ranks.filter((r) => r === 2).length,
      briefed: ranks.filter((r) => r === 3).length,
    };
  }
  return { people, everyone };
}

/** `{ userIds }` from a push request: a non-empty list of Clerk ids, at most 500, or null for everyone. */
export function parseTargets(body: unknown): string[] | null | undefined {
  const b = (body && typeof body === "object" ? body : {}) as { userId?: unknown; userIds?: unknown };
  if (b.userIds === undefined && b.userId === undefined) return null;
  const list = b.userIds !== undefined ? b.userIds : [b.userId];
  if (!Array.isArray(list) || list.length === 0 || list.length > 500 || !list.every(isUserId)) return undefined;
  return [...new Set(list as string[])];
}
