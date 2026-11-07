import { NextRequest, NextResponse } from "next/server";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { CORS_HEADERS, corsPreflight } from "@/lib/cors";
import { parseExtensionEvent, track } from "@/lib/events";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * The extension's own events: only its reminder popup (opened, a brief started
 * from it, closed with none), with the pairing token. Any other name is
 * refused, and nothing about the page is kept (lib/events parseExtensionEvent).
 */
export async function POST(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get("authorization"));
  const userId = token ? await userIdForToken(token) : null;
  if (!userId) return new NextResponse(null, { status: 401, headers: CORS_HEADERS });
  const event = parseExtensionEvent(await req.json().catch(() => null));
  if (!event) return new NextResponse(null, { status: 400, headers: CORS_HEADERS });
  track(userId, event.name, event.props);
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
