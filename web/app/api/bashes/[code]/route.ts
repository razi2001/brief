import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isBashCode } from "@/lib/bash";
import { deleteBash, loadBash } from "@/lib/bash-server";
import { track } from "@/lib/events";

/** The bash as its page shows it. The page asks again every few seconds while it runs. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { code } = await ctx.params;
  if (!isBashCode(code)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bash = await loadBash(code, userId);
  if (!bash) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(bash, { headers: { "cache-control": "no-store" } });
}

/** Delete a quality competition for good. Only whoever created it may; for anyone else it is a 404. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { code } = await ctx.params;
  if (!isBashCode(code)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const result = await deleteBash(userId, code);
  if (result === "missing") return NextResponse.json({ error: "not found" }, { status: 404 });
  if (result === "error") return NextResponse.json({ error: "could not delete" }, { status: 500 });
  track(userId, "bash.deleted");
  return NextResponse.json({ ok: true });
}
