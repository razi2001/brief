import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isBashCode } from "@/lib/bash";
import { isUuid } from "@/lib/tags";
import { dropReport, moveReport, type EditResult } from "@/lib/bash-review-server";

const answer = (result: EditResult) => {
  if (result === "ok") return NextResponse.json({ ok: true });
  if (result === "missing") return NextResponse.json({ error: "not found" }, { status: 404 });
  // The bash is still running, or the group is (or is becoming) a ticket.
  if (result === "running" || result === "locked") return NextResponse.json({ error: result }, { status: 409 });
  return NextResponse.json({ error: "could not save" }, { status: 500 });
};

/**
 * Place one report in the review: `{ to: <group id> }` moves it to that group,
 * `{ to: "new" }` gives it a group of its own (also how a dropped one comes
 * back), `{ drop: true }` leaves it out of every ticket.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ code: string; briefId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { code, briefId } = await ctx.params;
  if (!isBashCode(code) || !isUuid(briefId)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { to?: unknown; drop?: unknown };
  if (body.drop === true) return answer(await dropReport(code, userId, briefId));
  if (body.to === "new" || isUuid(body.to)) return answer(await moveReport(code, userId, briefId, body.to));
  return NextResponse.json({ error: "invalid" }, { status: 400 });
}
