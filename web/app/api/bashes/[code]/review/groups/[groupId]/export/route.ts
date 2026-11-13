import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isBashCode } from "@/lib/bash";
import { isUuid } from "@/lib/tags";
import { startGroupExport } from "@/lib/bash-review-server";

export const maxDuration = 300;

/**
 * Make one ticket out of a group. The claims are taken here, so two clicks
 * make one ticket; the filing runs in the background and the page reads the
 * group again to see it land. Only whoever started the bash may.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ code: string; groupId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { code, groupId } = await ctx.params;
  if (!isBashCode(code) || !isUuid(groupId)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const start = await startGroupExport(code, userId, groupId);
  if (start.ok) {
    after(start.run);
    return NextResponse.json({ queued: true });
  }
  if (start.reason === "missing") return NextResponse.json({ error: "not found" }, { status: 404 });
  if (start.reason === "tracker") return NextResponse.json({ error: "tracker", message: start.message }, { status: 409 });
  const message =
    start.reason === "filed"
      ? "This group already has a ticket."
      : start.reason === "filing"
        ? "This group is being filed right now."
        : start.reason === "empty"
          ? "Nothing to file yet: its reports are still being written up."
          : start.reason === "unwritten"
            ? "Brief's AI service didn't answer while writing these reports. Try again in a minute."
          : "The bug bash is still running.";
  return NextResponse.json({ error: start.reason, message }, { status: 409 });
}
