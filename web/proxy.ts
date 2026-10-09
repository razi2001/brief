import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Next.js 16 renamed the `middleware` file convention to `proxy`. Clerk's
// clerkMiddleware() runs from this file on Next 16 (it detects middleware|proxy).
// /api/briefs*, /api/me, /api/replay-sites and /api/transcribe are public to Clerk: the extension
// authenticates them via a bearer token, not a Clerk session (without this they
// would 307 to /sign-in and the extension could never reach them).
// /b/* are the public shareable brief pages (unguessable token, no session).
// /api/evidence/* serves a brief's screenshots to whoever holds the same
// unguessable share token. It MUST be public: the callers are trackers fetching
// an embedded <img> server-side (GitHub proxies every image through camo), and
// they have no Clerk session - protected, every screenshot in a filed ticket
// renders broken.
const isPublic = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/privacy",
  "/b/(.*)",
  "/api/briefs(.*)",
  "/api/me",
  "/api/replay-sites",
  "/api/transcribe",
  "/api/evidence/(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|gif|png|svg|ico|webp|woff2?|ttf|map)).*)",
    "/(api|trpc)(.*)",
  ],
};
