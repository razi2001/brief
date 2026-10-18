import { randomBytes } from "crypto";

/**
 * A brief's share token: the unguessable part of its public link (/b/<id>).
 * 9 random bytes, base64url: 12 characters, no padding.
 */
export function newShareId(): string {
  return randomBytes(9).toString("base64url");
}

/**
 * A share token the extension picked itself, so Public link and Fix prompt can copy the
 * link the moment it's clicked, before anything uploads. Only the exact shape
 * is taken; anything else gets a server-minted one.
 */
export function isShareId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{12}$/.test(v);
}

/** Postgres unique violation: the share token is already some brief's. */
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}
