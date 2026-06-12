import { clerkClient } from "@clerk/nextjs/server";

/**
 * Account-level settings stored on the Clerk user's privateMetadata
 * (server-writable + server-readable; no extra DB table): the natural-language
 * ticket guidance the server agent applies when filing, plus the reporter's
 * role captured during onboarding (light context for the agent).
 *
 * Reading is best-effort: any failure (Clerk unreachable, user missing) degrades
 * to empty rather than throwing, since the agent must still be able to file.
 */
export async function getUserSettings(
  userId: string,
): Promise<{ ticketGuidance: string; role: string }> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const raw = (user.privateMetadata?.ticketGuidance as string) ?? "";
    const role = ((user.privateMetadata?.role as string) ?? "").trim();
    return { ticketGuidance: raw.trim(), role };
  } catch {
    return { ticketGuidance: "", role: "" };
  }
}
