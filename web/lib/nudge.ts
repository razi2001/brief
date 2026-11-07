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
