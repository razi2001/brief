import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cleanBashName, cleanWindow, isDuration } from "@/lib/bash";
import { createBash } from "@/lib/bash-server";
import { track } from "@/lib/events";

/**
 * Create a bug bash: a name, a start and an end, and the time each person
 * gets. Answers with its link code.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = cleanBashName(body.name);
  if (!name) return NextResponse.json({ error: "name" }, { status: 400 });
  if (!isDuration(body.minutes)) return NextResponse.json({ error: "minutes" }, { status: 400 });
  const window = cleanWindow(body.startsAt, body.endsAt, Date.now());
  if (!window) return NextResponse.json({ error: "dates" }, { status: 400 });

  // Left out, the reports are held for a review.
  const hold = typeof body.hold === "boolean" ? body.hold : undefined;
  const result = await createBash(userId, name, body.minutes, window, hold);
  if (!result.ok) {
    return result.reason === "limit"
      ? NextResponse.json({ error: "limit" }, { status: 429 })
      : NextResponse.json({ error: "could not save" }, { status: 500 });
  }
  track(userId, "bash.started", { minutes: body.minutes, ...(hold === undefined ? {} : { hold }) });
  return NextResponse.json({ ok: true, code: result.code });
}
