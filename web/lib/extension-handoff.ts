/**
 * Carries the extension's pairing request across sign-up.
 *
 * Someone who installs the extension first reaches /connect?ext=<id> signed
 * out, so Clerk sends them to /sign-in?redirect_url=…/connect?ext=<id>. If
 * they sign up instead, sign-up forces /welcome (new accounts get onboarding)
 * and the redirect, with the extension id in it, is dropped. So the id is
 * remembered on the way in (localStorage "briefPendingExt"), and
 * ExtensionTokenSync pairs it once someone is signed in.
 */

export const PENDING_EXT_KEY = "briefPendingExt";
/** Fired on window when the extension takes a token from this page. */
export const EXT_PAIRED_EVENT = "brief-ext-paired";

const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
/** Chrome extension ids: 32 letters a to p. */
const EXT_ID = /^[a-p]{32}$/;

/** The extension id in a `redirect_url` pointing at this app's /connect, if any. */
export function extIdFromRedirect(search: string, origin: string): string | null {
  const redirect = new URLSearchParams(search).get("redirect_url");
  if (!redirect) return null;
  let url: URL;
  try {
    url = new URL(redirect, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.pathname !== "/connect") return null;
  const id = url.searchParams.get("ext");
  return id && EXT_ID.test(id) ? id : null;
}

export function rememberPendingExt(storage: Storage, id: string, now = Date.now()) {
  storage.setItem(PENDING_EXT_KEY, JSON.stringify({ id, at: now }));
}

/** The remembered id while it's fresh; a stale or broken entry is dropped. */
export function readPendingExt(storage: Storage, now = Date.now()): string | null {
  const raw = storage.getItem(PENDING_EXT_KEY);
  if (!raw) return null;
  try {
    const { id, at } = JSON.parse(raw) as { id?: unknown; at?: unknown };
    if (typeof id === "string" && EXT_ID.test(id) && typeof at === "number" && now - at < PENDING_TTL_MS) return id;
  } catch {}
  storage.removeItem(PENDING_EXT_KEY);
  return null;
}

export function clearPendingExt(storage: Storage) {
  storage.removeItem(PENDING_EXT_KEY);
}
