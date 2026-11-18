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
  "bash.started",
  "bash.joined",
  "bash.deleted",
] as const;
/** What a signed-in browser may send through POST /api/events. */
export const CLIENT_EVENTS = ["page.view", "onboarding.step", "onboarding.demo"] as const;
/** What get-brief.app may send through POST /api/t. */
export const SITE_EVENTS = ["site.view", "site.click", "site.demo"] as const;
/**
 * What the extension may send through POST /api/extension-events: its
 * reminder popup opened, a brief was started from it, or it closed with none.
 * Nothing else, and nothing about the page (the privacy page says so).
 */
export const EXTENSION_EVENTS = ["nudge.shown", "nudge.brief_it", "nudge.closed"] as const;

export type ServerEvent = (typeof SERVER_EVENTS)[number];
export type ClientEvent = (typeof CLIENT_EVENTS)[number];
export type SiteEvent = (typeof SITE_EVENTS)[number];
export type ExtensionEvent = (typeof EXTENSION_EVENTS)[number];
export type EventName = ServerEvent | ClientEvent | SiteEvent | ExtensionEvent;
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

/**
 * An extension event, or null when the name isn't one the extension may send.
 * The only prop kept is `replay` on nudge.shown (whether the page was one of
 * the user's Replay sites): anything else that comes is dropped.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseExtensionEvent(body: unknown): { name: ExtensionEvent; props: Props } | null {
  if (!body || typeof body !== "object") return null;
  const { name, props } = body as { name?: unknown; props?: unknown };
  if (!(EXTENSION_EVENTS as readonly unknown[]).includes(name)) return null;
  const p = (props && typeof props === "object" ? props : {}) as { replay?: unknown; push?: unknown };
  const out: Props = {};
  if (name === "nudge.shown" && typeof p.replay === "boolean") out.replay = p.replay;
  // the owner's push that opened it (nudge_pushes.id), for /admin/card
  if (typeof p.push === "string" && UUID.test(p.push)) out.push = p.push;
  return { name: name as ExtensionEvent, props: out };
}

/**
 * A page path with every id taken out, so the log says which kind of page
 * was opened, never which brief: "/b/Xk3..." -> "/b/:share",
 * "/tickets/6f1c-..." -> "/tickets/:id". A share id in the log would let
 * whoever reads the log open that ticket.
 */
export function pagePath(path: string): string {
  const clean = path.split(/[?#]/)[0] || "/";
  return clean
    .split("/")
    .map((seg, i, all) => {
      if (!seg) return seg;
      if (i === 2 && all[1] === "b") return ":share";
      if (/^[0-9a-f-]{16,}$/i.test(seg) || (/\d/.test(seg) && seg.length >= 8)) return ":id";
      return seg;
    })
    .join("/");
}

/**
 * A filing error reduced to its kind ("Linear 401", "timeout"), for the
 * owner's log. The raw message can quote the ticket back (a tracker
 * rejecting a field echoes it), so it only goes to the server log.
 */
export function errorKind(raw: string): string {
  const trackers = ["Azure DevOps", "Jira", "Linear", "GitHub", "GitLab", "ClickUp", "Notion", "Trello", "Asana", "Monday", "OpenAI"];
  const tracker = trackers.find((t) => raw.toLowerCase().includes(t.toLowerCase()));
  const status = /\b([45]\d{2})\b/.exec(raw)?.[1];
  if (status) return `${tracker ?? "HTTP"} ${status}`;
  if (/time(d)?\s?out|aborted/i.test(raw)) return `${tracker ? `${tracker} ` : ""}timeout`;
  if (/no tracker|not connected|reconnect/i.test(raw)) return "no tracker";
  if (/did not create|no issue/i.test(raw)) return "agent made no ticket";
  return tracker ? `${tracker} error` : "other";
}

/** A browser event, or null when the name isn't one the browser may send. */
export function parseClientEvent(body: unknown): { name: ClientEvent; props: Props } | null {
  if (!body || typeof body !== "object") return null;
  const { name, props } = body as { name?: unknown; props?: unknown };
  if (!(CLIENT_EVENTS as readonly unknown[]).includes(name)) return null;
  const clean = cleanProps(props && typeof props === "object" ? (props as Record<string, unknown>) : {});
  if (typeof clean.path === "string") clean.path = pagePath(clean.path);
  return { name: name as ClientEvent, props: clean };
}
