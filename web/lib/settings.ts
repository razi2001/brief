import { clerkClient } from "@clerk/nextjs/server";

/**
 * Account-level settings stored on the Clerk user's privateMetadata
 * (server-writable + server-readable; no extra DB table). Today this is just
 * the natural-language ticket guidance the server agent applies when filing.
 *
 * Reading is best-effort: any failure (Clerk unreachable, user missing) degrades
 * to empty rather than throwing, since the agent must still be able to file.
 */
export async function getUserSettings(
  userId: string,
): Promise<{ ticketGuidance: string }> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const raw = (user.privateMetadata?.ticketGuidance as string) ?? "";
    return { ticketGuidance: raw.trim() };
  } catch {
    return { ticketGuidance: "" };
  }
}
