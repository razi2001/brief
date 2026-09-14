import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";

export const maxDuration = 60;

// Max stored length for ticket guidance. Capped on write so a single setting
// can't bloat the Clerk user record.
const MAX_GUIDANCE = 4000;
const MAX_ROLE = 100;
const MAX_SOURCE = 100;

// Clerk-session-authed account settings - PARTIAL updates: only the keys
// present in the body are written (Clerk merges privateMetadata top-level
// keys), so e.g. the onboarding wizard saving `role` can never wipe the
// ticket guidance. proxy.ts protects this route by default (it isn't on the
// public matcher), but protected API routes still run their handler for authed
// same-origin fetches - the dashboard fetch carries the Clerk session cookie -
// so the handler self-authenticates via auth().
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const updates: Record<string, unknown> = {};
  if ("ticketGuidance" in body) {
    updates.ticketGuidance = String(body.ticketGuidance ?? "").trim().slice(0, MAX_GUIDANCE);
  }
  // Whether this user follows their org's ticket guidance or their own. Stored
  // explicitly rather than inferred from the text being empty, so "override
  // with deliberately nothing" is expressible and clearing the box is never
  // mistaken for opting back into the team defaults.
  if ("ticketGuidanceMode" in body) {
    const mode = String(body.ticketGuidanceMode ?? "");
    if (mode !== "inherit" && mode !== "override") {
      return NextResponse.json({ error: "invalid ticketGuidanceMode" }, { status: 400 });
    }
    updates.ticketGuidanceMode = mode;
  }
  if ("role" in body) {
    updates.role = String(body.role ?? "").trim().slice(0, MAX_ROLE);
  }
  // Attribution captured during onboarding ("how'd you hear about us").
  if ("source" in body) {
    updates.source = String(body.source ?? "").trim().slice(0, MAX_SOURCE);
  }
  // Any truthy value marks onboarding done "now" (server clock - the client
  // never supplies the timestamp); null clears it (useful for re-testing).
  if ("onboardedAt" in body) {
    updates.onboardedAt = body.onboardedAt ? new Date().toISOString() : null;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no recognized settings in body" }, { status: 400 });
  }

  try {
    const client = await clerkClient();
    await client.users.updateUserMetadata(userId, {
      privateMetadata: updates,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
