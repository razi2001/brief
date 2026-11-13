import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isBashCode } from "@/lib/bash";
import { loadBash } from "@/lib/bash-server";

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
