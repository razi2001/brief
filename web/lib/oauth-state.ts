import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { OwnedProvider } from "./connections";

/**
 * Signed OAuth `state` for the app-owned connect flow.
 *
 * The callback has to know WHICH Brief user started the flow, and it must not
 * take that on trust from the query string: an attacker who can get a victim to
 * load a crafted callback URL would otherwise attach their own tracker account
 * to the victim's Brief account (or the reverse). Signing the state with a
 * server secret makes a forged callback unusable.
 *
 * The callback also re-checks the signed-in user against the state, so this is
 * defence in depth rather than the only guard.
 */

export type OAuthState = {
  userId: string;
  provider: OwnedProvider;
  returnTo: string;
  /** Issued-at, epoch ms - bounds how long a started flow stays completable. */
  ts: number;
};

/** How long a started flow may take to come back. */
export const STATE_TTL_MS = 15 * 60 * 1000;

/**
 * The HMAC key. It is derived from CONNECTIONS_KEY when that is set, else from
 * CLERK_SECRET_KEY, which every deployment has (the app cannot boot without
 * it) and which never reaches the browser, so signing needs no env var of its
 * own. Either secret is hashed with a purpose label first: CONNECTIONS_KEY is
 * also the token encryption key, and one raw key should not serve two
 * algorithms.
 */
function signingKey(purpose: string): Buffer {
  const s = process.env.CONNECTIONS_KEY || process.env.CLERK_SECRET_KEY;
  if (!s) throw new Error("No secret available to sign OAuth state.");
  return createHash("sha256").update(`${purpose}:${s}`).digest();
}

/**
 * An HMAC for another value Brief signs, keyed by its own purpose label, so a
 * value signed for one purpose never verifies as another. Throws when there
 * is no secret to sign with.
 */
export function macFor(purpose: string, payload: string): string {
  return createHmac("sha256", signingKey(purpose)).update(payload).digest("base64url");
}

function sign(payload: string): string {
  return macFor("brief-oauth-state", payload);
}

export function signState(state: Omit<OAuthState, "ts"> & { ts?: number }): string {
  const full: OAuthState = { ...state, ts: state.ts ?? Date.now() };
  const payload = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Verify and decode. Returns null for anything tampered with, or too old. */
export function readState(raw: string | null | undefined, now = Date.now()): OAuthState | null {
  if (!raw) return null;
  const [payload, mac] = raw.split(".");
  if (!payload || !mac) return null;
  try {
    const expected = Buffer.from(sign(payload));
    const given = Buffer.from(mac);
    // Length check first: timingSafeEqual throws on a length mismatch.
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (!state?.userId || !state?.provider) return null;
    if (!Number.isFinite(state.ts) || now - state.ts > STATE_TTL_MS) return null;
    return state;
  } catch {
    return null;
  }
}
