import { after } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";

/**
 * The owner's activity log (/admin/activity). Every name is listed here, so a
 * typo is a type error and the browser can't invent rows.
 */
export const SERVER_EVENTS = [
  "onboarding.about",
  "onboarding.finished",
  "tracker.connect_start",
  "tracker.connected",
  "tracker.connect_failed",
  "tracker.disconnected",
  "extension.paired",
  "extension.opened",
  "brief.created",
  "brief.file_refused",
  "brief.filed",
  "brief.drafted",
  "brief.failed",
  "brief.retry",
  "brief.archived",
  "brief.deleted",
] as const;
/** What a signed-in browser may send through POST /api/events. */
export const CLIENT_EVENTS = ["page.view", "onboarding.step", "onboarding.demo"] as const;
/** What get-brief.app may send through POST /api/t. */
export const SITE_EVENTS = ["site.view", "site.click", "site.demo"] as const;

export type ServerEvent = (typeof SERVER_EVENTS)[number];
export type ClientEvent = (typeof CLIENT_EVENTS)[number];
export type SiteEvent = (typeof SITE_EVENTS)[number];
export type EventName = ServerEvent | ClientEvent | SiteEvent;
export type Props = Record<string, string | number | boolean>;

const MAX_KEYS = 12;
const MAX_STRING = 200;

/** Flat scalars only, strings capped: a row stays small whatever is passed. */
export function cleanProps(props: Record<string, unknown>): Props {
  const out: Props = {};
  for (const [k, v] of Object.entries(props)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    if (typeof v === "string") out[k] = v.slice(0, MAX_STRING);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

/**
 * Record one event after the response is sent. Never throws and never delays
 * the request: a lost event is better than a failed filing.
 */
export function track(userId: string | null, name: EventName, props: Record<string, unknown> = {}): void {
  const write = async () => {
    try {
      const { error } = await createAdminSupabase()
        .from("events")
        .insert({ user_id: userId, name, props: cleanProps(props) });
      if (error) console.warn(`[events] ${name} not recorded: ${error.message}`);
    } catch (e) {
      console.warn(`[events] ${name} not recorded:`, e instanceof Error ? e.message : e);
    }
  };
  try {
    after(write);
  } catch {
    // Outside a request (a background job): write now, still unawaited.
    void write();
  }
}

/** A browser event, or null when the name isn't one the browser may send. */
export function parseClientEvent(body: unknown): { name: ClientEvent; props: Props } | null {
  if (!body || typeof body !== "object") return null;
  const { name, props } = body as { name?: unknown; props?: unknown };
  if (!(CLIENT_EVENTS as readonly unknown[]).includes(name)) return null;
  return {
    name: name as ClientEvent,
    props: cleanProps(props && typeof props === "object" ? (props as Record<string, unknown>) : {}),
  };
}
