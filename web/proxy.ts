import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Next.js 16 renamed the `middleware` file convention to `proxy`. Clerk's
// clerkMiddleware() runs from this file on Next 16 (it detects middleware|proxy).
// /api/briefs*, /api/me, and /api/transcribe are public to Clerk: the extension
// authenticates them via a bearer token, not a Clerk session (without this they
// would 307 to /sign-in and the extension could never reach them).
const isPublic = createRouteMatcher(["/sign-in(.*)", "/privacy", "/api/briefs(.*)", "/api/me", "/api/transcribe"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|gif|png|svg|ico|webp|woff2?|ttf|map)).*)",
    "/(api|trpc)(.*)",
  ],
};
