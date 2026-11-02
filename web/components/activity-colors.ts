// Chart colors for /admin/activity. A channel keeps its color on every chart:
// LinkedIn blue, any other site aqua, no referrer gray. One-series charts
// wear the brand accent.

import { NO_REFERRER } from "@/lib/channels";

export const ACCENT = "#dd6936";
export const ACCENT_LIGHT = "#f2c3ab";
export const LINKEDIN = "#2a78d6";
export const OTHER_SITE = "#1baf7a";
export const NONE = "#cbc3b6";

export const channelColor = (channel: string) =>
  channel === "LinkedIn" ? LINKEDIN : channel === NO_REFERRER ? NONE : OTHER_SITE;

/** "Oct 21" for "2026-10-21". */
export const shortDay = (day: string, weekday = false) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(weekday ? { weekday: "short" } : {}),
  });
