import { cleanProps, type Props, type SiteEvent } from "@/lib/events";

/** The marketing site. Anything else posting to /api/t is dropped. */
export const SITE_ORIGINS = ["https://get-brief.app", "https://www.get-brief.app"];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// The fields each event may carry; anything else in the body is dropped.
const FIELDS: Record<SiteEvent, string[]> = {
  "site.view": ["path", "ref", "utm_source", "utm_medium", "utm_campaign", "pv"],
  "site.click": ["target", "where", "pv"],
  "site.demo": ["act", "pv"],
};

const MAX_BODY = 2048;
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python|node-fetch|axios|go-http/i;

export function isBot(ua: string): boolean {
  return !ua.trim() || BOT.test(ua);
}

export function deviceOf(ua: string): "mobile" | "desktop" {
  return /Mobi|Android|iPhone|iPad/i.test(ua) ? "mobile" : "desktop";
}

/** A website event worth a row, or null. No IP is kept; the device comes from the user agent. */
export function parseSiteEvent(
  raw: string,
  req: { origin: string | null; ua: string; dev: boolean },
): { name: SiteEvent; props: Props } | null {
  const origin = req.origin ?? "";
  if (!SITE_ORIGINS.includes(origin) && !(req.dev && LOCAL.test(origin))) return null;
  if (isBot(req.ua) || raw.length > MAX_BODY) return null;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  const { name, props } = (body ?? {}) as { name?: unknown; props?: unknown };
  if (typeof name !== "string" || !Object.hasOwn(FIELDS, name)) return null;
  const given = props && typeof props === "object" ? (props as Record<string, unknown>) : {};
  const kept = Object.fromEntries(FIELDS[name as SiteEvent].filter((k) => k in given).map((k) => [k, given[k]]));
  return { name: name as SiteEvent, props: { ...cleanProps(kept), device: deviceOf(req.ua) } };
}
