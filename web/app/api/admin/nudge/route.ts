import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isAdmin } from "@/lib/admin-server";
import { parseText } from "@/lib/nudge";
import { saveText } from "@/lib/nudge-server";

/** The owner sets the card's text. Empty fields go back to the built-in text. */
export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const text = parseText(await req.json().catch(() => null));
  if (!text) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (!(await saveText(text))) return NextResponse.json({ error: "could not save" }, { status: 500 });
  return NextResponse.json({ ok: true, ...text });
}
