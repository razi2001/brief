import { NextResponse } from "next/server";

// The extension calls these endpoints cross-origin (chrome-extension:// → localhost).
// Requests carry a bearer token (no cookies), so a wildcard origin is safe.
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Max-Age": "86400",
};

export function corsPreflight() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export function jsonCors(data: unknown, init?: { status?: number }) {
  return NextResponse.json(data, { status: init?.status ?? 200, headers: CORS_HEADERS });
}
