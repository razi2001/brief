import { createHash, randomBytes, timingSafeEqual } from "crypto";

export function generateExtensionToken(): string {
  return "bxt_" + randomBytes(32).toString("base64url");
}
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function verifyToken(token: string, hash: string): boolean {
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
