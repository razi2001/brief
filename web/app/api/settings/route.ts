import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";

export const maxDuration = 60;

// Max stored length for ticket guidance. Capped on write so a single setting
// can't bloat the Clerk user record.
const MAX_GUIDANCE = 4000;

// Clerk-session-authed account settings. proxy.ts protects this route by
// default (it isn't on the public matcher), but protected API routes still run
// their handler for authed same-origin fetches — the dashboard fetch carries
// the Clerk session cookie — so the handler self-authenticates via auth().
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const raw = (body as { ticketGuidance?: unknown })?.ticketGuidance;
  const ticketGuidance = String(raw ?? "").trim().slice(0, MAX_GUIDANCE);

  try {
    const client = await clerkClient();
    await client.users.updateUserMetadata(userId, {
      privateMetadata: { ticketGuidance },
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
