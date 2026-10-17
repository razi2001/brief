// The account photo a tracker connect brings along, for a Brief user with no
// photo of their own.
//
// A tracker connected through Clerk lent its account's photo to the user's
// Clerk profile when they had none. Brief-held connections don't, and the
// move off Clerk deletes that Clerk account, photo and all. So a Brief connect
// reads the photo from the tracker with the new token and uploads it as the
// user's Clerk profile image, before the callback removes any Clerk tracker
// account. Only for a user without a photo of their own: an uploaded one, or
// one from a sign-in method such as Google, is never replaced.
//
// Best effort throughout: every failure is logged by name and skipped, and
// nothing here can fail the connect. The photo is fetched once, uploaded to
// Clerk and not kept anywhere else.

import { clerkClient } from "@clerk/nextjs/server";
import { clickupAuthHeader } from "@/lib/clickup";
import { CLERK_PROVIDERS } from "@/lib/trackers/registry";
import type { OwnedProvider } from "@/lib/connections";

/** Clerk takes profile images up to 10 MB. */
export const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
/** Every tracker and image request of one connect shares this budget. */
const FETCH_BUDGET_MS = 8_000;
/** The whole step, Clerk's calls included: the browser is waiting on the callback. */
const STEP_BUDGET_MS = 10_000;
/** An image host may redirect (Gravatar to its default image), but not forever. */
const MAX_REDIRECTS = 3;

/** What the connect knows that a photo lookup may need. */
export type AvatarContext = {
  accessToken: string;
  /** The photo, when the token reply names it (Notion). */
  avatarUrl?: string;
  /** A Jira site's cloud id: Jira's profile is read through a site. */
  siteId?: string;
  /** Trello's app key, which every Trello call carries beside the token. */
  apiKey?: string;
};

/**
 * How the step went: `set` uploaded, `kept` the user has a photo of their
 * own, `none` the tracker had no usable photo, `failed` or `timeout` skipped.
 */
export type AvatarOutcome = "set" | "kept" | "none" | "failed" | "timeout";

// ---------------------------------------------------------------------------
// Does the user have a photo of their own?
// ---------------------------------------------------------------------------

/** The parts of a Clerk backend user this reads. */
export type ImageUser = {
  hasImage?: boolean;
  imageUrl?: string;
  externalAccounts?: Array<{ provider?: string; imageUrl?: string }>;
};

/**
 * What a Clerk image URL shows. img.clerk.com URLs carry their source as
 * base64url JSON ({ type: "proxy" | "upload" | "default", src }), so two URLs
 * for one picture are compared by it. Null when the URL is not one of those.
 */
export function clerkImage(url: string | undefined): { type?: string; src?: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname !== "img.clerk.com") return null;
    const seg = u.pathname.split("/").filter(Boolean)[0] ?? "";
    const j = JSON.parse(Buffer.from(seg, "base64url").toString("utf8")) as { type?: unknown; src?: unknown };
    return {
      type: typeof j?.type === "string" ? j.type : undefined,
      src: typeof j?.src === "string" ? j.src : undefined,
    };
  } catch {
    return null;
  }
}

function sameImage(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const sa = clerkImage(a)?.src;
  return !!sa && sa === clerkImage(b)?.src;
}

/** The provider substrings of the Clerk tracker accounts (Linear, Jira, GitHub). */
function trackerMatches(): string[] {
  return CLERK_PROVIDERS.map((d) => (d.clerkMatch ?? "").toLowerCase()).filter(Boolean);
}

/**
 * Does this Clerk user have a photo of their own, one a tracker's must never
 * replace? No when Clerk shows its default avatar, or when the photo is a
 * Clerk tracker account's alone: that account is about to be deleted, and the
 * photo with it. Yes for an upload, for a photo from any other external
 * account (a sign-in method such as Google), and whenever the photo's origin
 * can't be told.
 */
export function hasOwnImage(user: ImageUser, matches: string[] = trackerMatches()): boolean {
  if (!user.hasImage) return false;
  const mine = user.imageUrl;
  if (!mine) return true;
  if (clerkImage(mine)?.type === "upload") return true;
  const isTracker = (provider: string | undefined) => {
    const p = (provider ?? "").toLowerCase();
    return matches.some((m) => p.includes(m));
  };
  const accounts = user.externalAccounts ?? [];
  if (accounts.some((a) => !isTracker(a.provider) && sameImage(a.imageUrl, mine))) return true;
  return !accounts.some((a) => isTracker(a.provider) && sameImage(a.imageUrl, mine));
}

// ---------------------------------------------------------------------------
// Where each tracker keeps the photo
// ---------------------------------------------------------------------------

/** A photo's address (and the headers its host needs), or the photo itself. */
type Source = { url: string; headers?: Record<string, string> } | { bytes: Uint8Array<ArrayBuffer> };

async function getJson<T>(url: string, init: RequestInit, signal: AbortSignal): Promise<T | null> {
  const r = await fetch(url, { ...init, signal });
  return r.ok ? ((await r.json()) as T) : null;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: "application/json" });

/** The URL of the largest of several sizes keyed "48x48" or "image_128x128". */
function largest(sizes: Record<string, unknown> | null | undefined): string | undefined {
  let best: { px: number; url: string } | undefined;
  for (const [key, url] of Object.entries(sizes ?? {})) {
    const px = Number(/(\d+)x\d+/.exec(key)?.[1]);
    if (typeof url === "string" && url && Number.isFinite(px) && (!best || px > best.px)) best = { px, url };
  }
  return best?.url;
}

const urlSource = (url: string | null | undefined): Source | null => (url ? { url } : null);

/** Where `provider` keeps this account's photo, or null when it has none to give. */
async function avatarSource(provider: OwnedProvider, ctx: AvatarContext, signal: AbortSignal): Promise<Source | null> {
  const token = ctx.accessToken;
  switch (provider) {
    case "linear": {
      const j = await getJson<{ data?: { viewer?: { avatarUrl?: string | null } } }>(
        "https://api.linear.app/graphql",
        {
          method: "POST",
          headers: { ...bearer(token), "Content-Type": "application/json" },
          body: JSON.stringify({ query: "query { viewer { avatarUrl } }" }),
        },
        signal,
      );
      const url = j?.data?.viewer?.avatarUrl;
      if (!url) return null;
      // Files uploaded to Linear need the token; public ones don't get it.
      return safeUrl(url)?.hostname === "uploads.linear.app" ? { url, headers: { Authorization: `Bearer ${token}` } } : { url };
    }
    case "github": {
      const me = await getJson<{ avatar_url?: string }>(
        "https://api.github.com/user",
        { headers: { ...bearer(token), Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } },
        signal,
      );
      return urlSource(me?.avatar_url);
    }
    case "jira": {
      if (!ctx.siteId) return null;
      const me = await getJson<{ avatarUrls?: Record<string, string> }>(
        `https://api.atlassian.com/ex/jira/${encodeURIComponent(ctx.siteId)}/rest/api/3/myself`,
        { headers: bearer(token) },
        signal,
      );
      return urlSource(largest(me?.avatarUrls));
    }
    case "gitlab": {
      const me = await getJson<{ avatar_url?: string | null }>("https://gitlab.com/api/v4/user", { headers: bearer(token) }, signal);
      return urlSource(me?.avatar_url);
    }
    case "azure": {
      // The documented profile read, with the Avatar core attribute: its
      // value is the image itself, base64, and says when it is a generated
      // placeholder rather than a photo.
      const me = await getJson<{ coreAttributes?: { Avatar?: { value?: unknown } } }>(
        "https://app.vssps.visualstudio.com/_apis/profile/profiles/me?details=true&coreAttributes=Avatar&api-version=7.1",
        { headers: bearer(token) },
        signal,
      );
      return azureAvatar(me?.coreAttributes?.Avatar?.value);
    }
    case "clickup": {
      const j = await getJson<{ user?: { profilePicture?: string | null } }>(
        "https://api.clickup.com/api/v2/user",
        { headers: { Authorization: clickupAuthHeader(token), Accept: "application/json" } },
        signal,
      );
      return urlSource(j?.user?.profilePicture);
    }
    case "notion":
      // The token reply named it, or there is none.
      return urlSource(ctx.avatarUrl);
    case "trello": {
      const key = ctx.apiKey ?? "";
      const j = await getJson<{ avatarUrl?: string | null }>(
        `https://api.trello.com/1/members/me?fields=avatarUrl&key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`,
        { headers: { Accept: "application/json" } },
        signal,
      );
      // avatarUrl is a base; the size is a path segment.
      return urlSource(j?.avatarUrl ? `${j.avatarUrl.replace(/\/+$/, "")}/170.png` : null);
    }
    case "asana": {
      const j = await getJson<{ data?: { photo?: Record<string, string> | null } }>(
        "https://app.asana.com/api/1.0/users/me?opt_fields=photo",
        { headers: bearer(token) },
        signal,
      );
      return urlSource(largest(j?.data?.photo));
    }
    case "monday": {
      const j = await getJson<{ data?: { me?: { photo_original?: string | null } } }>(
        "https://api.monday.com/v2",
        {
          method: "POST",
          // monday takes the bare token, with no "Bearer" scheme; me:read covers this.
          headers: { Authorization: token, "API-Version": "2026-07", "Content-Type": "application/json" },
          body: JSON.stringify({ query: "query { me { photo_original } }" }),
        },
        signal,
      );
      return urlSource(j?.data?.me?.photo_original);
    }
  }
}

/** Azure DevOps' Avatar attribute: { isAutoGenerated, value: base64 }, or the base64 alone. */
function azureAvatar(attr: unknown): Source | null {
  const a = attr as { isAutoGenerated?: boolean; value?: unknown } | string | null | undefined;
  if (!a) return null;
  if (typeof a === "object" && a.isAutoGenerated) return null;
  const b64 = typeof a === "string" ? a : typeof a.value === "string" ? a.value : "";
  if (!b64) return null;
  const decoded = Buffer.from(b64, "base64");
  if (!decoded.length || decoded.length > MAX_AVATAR_BYTES) return null;
  return { bytes: new Uint8Array(decoded) };
}

// ---------------------------------------------------------------------------
// The photo's bytes
// ---------------------------------------------------------------------------

/**
 * An https URL on a public host name, or null. The address comes from a
 * tracker's reply, so the server never follows one to a bare IP, localhost
 * or Fly's private network.
 */
function safeUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || !host.includes(".")) return null;
  if (host.startsWith("[") || /^\d+(\.\d+){3}$/.test(host)) return null;
  if (/(^|\.)(localhost|internal|local)$/.test(host)) return null;
  return u;
}

/** A raster image type Clerk can show. SVG is refused: it is a document, not a photo. */
function imageType(contentType: string | null): string | null {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return type.startsWith("image/") && type !== "image/svg+xml" ? type : null;
}

/** What a byte string is, from its first bytes: the types a profile photo comes in. */
export function sniffImageType(b: Uint8Array): string | null {
  const at = (i: number, ...want: number[]) => want.every((v, k) => b[i + k] === v);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

/** The body, or null once it runs past `max` bytes (the rest is never read). */
async function readCapped(res: Response, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  if (!total) return null;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * Download a photo: https only, redirects followed by hand (each one checked
 * like the first, the headers kept for the original host alone), an image
 * type, at most MAX_AVATAR_BYTES.
 */
async function download(
  source: { url: string; headers?: Record<string, string> },
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string } | null> {
  let url = safeUrl(source.url);
  const host = url?.host;
  for (let hop = 0; url && hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, {
      headers: url.host === host ? source.headers : undefined,
      redirect: "manual",
      signal,
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      url = next ? safeUrl(new URL(next, url).toString()) : null;
      continue;
    }
    if (!res.ok) return null;
    const type = imageType(res.headers.get("content-type"));
    if (!type || Number(res.headers.get("content-length")) > MAX_AVATAR_BYTES) return null;
    const bytes = await readCapped(res, MAX_AVATAR_BYTES);
    return bytes ? { bytes, type } : null;
  }
  return null;
}

const EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** The tracker account's photo, as a file Clerk can take, or null. */
export async function fetchTrackerAvatar(
  provider: OwnedProvider,
  ctx: AvatarContext,
  signal: AbortSignal = AbortSignal.timeout(FETCH_BUDGET_MS),
): Promise<File | null> {
  const source = await avatarSource(provider, ctx, signal);
  if (!source) return null;
  const image =
    "bytes" in source
      ? (() => {
          const type = sniffImageType(source.bytes);
          return type ? { bytes: source.bytes, type } : null;
        })()
      : await download(source, signal);
  if (!image) return null;
  return new File([image.bytes], `avatar.${EXTENSION[image.type] ?? "img"}`, { type: image.type });
}

/**
 * Before a Clerk tracker account is removed: when the photo the user shows is
 * that account's and they have none of their own, upload it as their profile
 * photo, so removing the account (a switch, or a Disconnect) does not take the
 * photo with it. Best effort: never throws, false when nothing was kept.
 */
export async function keepPhotoOf(
  user: ImageUser,
  account: { imageUrl?: string },
  upload: (file: File) => Promise<unknown>,
): Promise<boolean> {
  try {
    if (hasOwnImage(user) || !account.imageUrl || !sameImage(account.imageUrl, user.imageUrl)) return false;
    const image = await download({ url: account.imageUrl }, AbortSignal.timeout(FETCH_BUDGET_MS));
    if (!image) return false;
    await upload(new File([image.bytes], `avatar.${EXTENSION[image.type] ?? "img"}`, { type: image.type }));
    return true;
  } catch (err) {
    console.warn("[connect] could not keep the photo of a removed tracker account:", err instanceof Error ? err.name : "unknown error");
    return false;
  }
}

// ---------------------------------------------------------------------------
// The step the connect callback runs
// ---------------------------------------------------------------------------

async function adopt(userId: string, provider: OwnedProvider, ctx: AvatarContext): Promise<AvatarOutcome> {
  // Nothing to look up: skip even the Clerk read.
  if (provider === "notion" && !ctx.avatarUrl) return "none";
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  if (hasOwnImage(user)) return "kept";
  const file = await fetchTrackerAvatar(provider, ctx);
  if (!file) return "none";
  await client.users.updateUserProfileImage(userId, { file });
  return "set";
}

/**
 * Give a user with no photo of their own the photo of the tracker account
 * just connected. Run after the token is saved and before any Clerk tracker
 * account is removed, as that account's photo may be the one shown. Never
 * throws, and gives up after STEP_BUDGET_MS.
 */
export async function adoptTrackerAvatar(
  userId: string,
  provider: OwnedProvider,
  ctx: AvatarContext,
): Promise<AvatarOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<AvatarOutcome>((resolve) => {
    timer = setTimeout(() => resolve("timeout"), STEP_BUDGET_MS);
  });
  try {
    const outcome = await Promise.race([adopt(userId, provider, ctx), late]);
    if (outcome === "timeout") console.warn(`[connect] gave up on the ${provider} photo: too slow`);
    return outcome;
  } catch (err) {
    console.warn(`[connect] could not set the ${provider} photo:`, err instanceof Error ? err.name : "unknown error");
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}
