import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isBashCode } from "@/lib/bash";
import { loadBash } from "@/lib/bash-server";
import { ensureGrouped } from "@/lib/bash-review-server";

// Grouping asks the model once per bash; give it room.
export const maxDuration = 120;

/**
 * Open the review of a bug bash that is over and held its reports: put them in groups
 * (the first time only) and answer with the bash as its page shows it. Only
 * whoever started it may; for anyone else it is a 404.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { code } = await ctx.params;
  if (!isBashCode(code)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const result = await ensureGrouped(code, userId);
  if (result === "missing") return NextResponse.json({ error: "not found" }, { status: 404 });
  if (result === "running") return NextResponse.json({ error: "running" }, { status: 409 });
  if (result === "error") return NextResponse.json({ error: "could not group" }, { status: 500 });

  const bash = await loadBash(code, userId);
  if (!bash) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(bash, { headers: { "cache-control": "no-store" } });
}
