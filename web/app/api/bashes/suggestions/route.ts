import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { suggestBashes } from "@/lib/bash-suggest-server";

export const maxDuration = 60;

/**
 * Bashes worth starting: the areas the caller's team keeps filing bugs about.
 * Asked by the start page after it has drawn, so a slow answer never holds the
 * page. An empty list is a normal answer.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const suggestions = await suggestBashes(userId).catch(() => []);
  return NextResponse.json({ suggestions }, { headers: { "cache-control": "no-store" } });
}
