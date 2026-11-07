import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Next.js 16 renamed the `middleware` file convention to `proxy`. Clerk's
// clerkMiddleware() runs from this file on Next 16 (it detects middleware|proxy).
// /api/briefs*, /api/me, /api/replay-sites, /api/nudge, /api/extension-events, /api/transcribe and /api/describe are public to Clerk: the extension
// authenticates them via a bearer token, not a Clerk session (without this they
// would 307 to /sign-in and the extension could never reach them).
// /b/* are the public shareable brief pages (unguessable token, no session).
// /api/evidence/* serves a brief's screenshots to whoever holds the same
// unguessable share token. It MUST be public: the callers are trackers fetching
// an embedded <img> server-side (GitHub proxies every image through camo), and
// they have no Clerk session - protected, every screenshot in a filed ticket
// renders broken.
// /api/t is get-brief.app's page-view beacon: no session, app/api/t checks the
// origin.
const isPublic = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/privacy",
  "/b/(.*)",
  "/api/briefs(.*)",
  "/api/me",
  "/api/replay-sites",
  "/api/nudge",
  "/api/extension-events",
  "/api/transcribe",
  "/api/describe",
  "/api/evidence/(.*)",
  "/api/t",
]);

// /b/<shareId>.md is that page as Markdown for a coding agent (the extension's
// Fix prompt links it), served by app/b/[shareId]/md.
const AGENT_REPORT = /^\/b\/([A-Za-z0-9_-]+)\.md$/;

export default clerkMiddleware(async (auth, req) => {
  const md = AGENT_REPORT.exec(req.nextUrl.pathname);
  if (md) return NextResponse.rewrite(new URL(`/b/${md[1]}/md`, req.url));
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|gif|png|svg|ico|webp|woff2?|ttf|map)).*)",
    "/(api|trpc)(.*)",
  ],
};
