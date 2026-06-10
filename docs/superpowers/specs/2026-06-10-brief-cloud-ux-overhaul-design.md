# Brief Cloud — UX overhaul design

**Date:** 2026-06-10
**Status:** Approved (user waived spec review — "gooooo dont ask questions anymore")

## Goal

Restructure the Brief Cloud web app from a single `/dashboard` (editorial hero + client
tabs) into three real, separate views, add a stats-forward Dashboard, make the Briefs feed
denser/Linear-like with honest progress, simplify Connections and surface MCP, fix the
archive bug, and clean up the extension's create-ticket flow + settings page.

## Decisions (from brainstorming)

1. **Navigation:** 3 top-level routes — Dashboard / Briefs / Connections. Remove the
   "hey {name}, here's the brief" hero.
2. **Dashboard:** stats-forward (charts) + recent tickets.
3. **Stuck briefs:** fail fast (~90s orphan timeout) + show elapsed time per processing brief.
4. **Extension settings page:** removed; replaced with a "My briefs" button.
5. **MCP (§4):** advertise a Brief MCP server (assumption confirmed by "go").
6. **Create ticket (§6):** fire upload, green "Sent ✓ — opening your briefs…", open `/briefs`
   in a new tab, close the bar.

## 1. Architecture & navigation

- Three routes sharing the existing `AppShell`:
  - `/dashboard` — stats + recent tickets (landing; `/` redirects here)
  - `/briefs` — the brief cards/list feed
  - `/connections` — trackers + MCP + ticket guidance
- New `Nav` component: slim segmented-pill nav rendered as real `<Link>`s in the AppShell
  header area, reusing today's segmented-control styling. Active state from the pathname.
- The hero `<h1>` is deleted. `DashboardTabs` is decomposed: its Briefs-feed logic moves to
  `/briefs`, its Connections content moves to `/connections`.

*Rationale:* deep-linkable URLs (extension → `/briefs`), smaller per-view code, matches the
"own place, not buried" intent.

## 2. Dashboard (stats-forward)

- New aggregate query (`lib/stats.ts` or inline in the page) over **all** of the user's
  briefs (select `id, status, created_at, ticket_url, source_kind`) — single-user, cheap.
- **Stat strip:** Tickets filed · Filed via Brief · In progress · Didn't file · This week.
- **Trend chart:** tickets filed per day, last 14 days. Hand-rolled SVG bars (no chart
  library) to match the cream/editorial aesthetic and keep the bundle small.
- **Status breakdown:** live tracker states (Todo / In progress / Done…) as a compact
  stacked bar, reusing the existing Linear/Jira live-sync (`getIssuesByIdentifiers`,
  `getJiraIssues`).
- **Recent tickets:** short Linear-like list (title · status dot · tracker logo · date ·
  assignee), linking to the real ticket URL.

## 3. Briefs page

- Move the existing feed (filter popover, optimistic archive, auto-refresh) to `/briefs`.
- Replace the big 2-col `BriefCard` grid with a denser **Linear-like list** of rows
  (reuse/extend `BriefRow`): status dot, title/summary, tracker, time, archive affordance.
- **Fail-fast:** orphan-recovery cutoff `4 min → ~90s`. Each processing brief shows
  **elapsed time** ("filing… 0:42") via a small client ticker, so nothing appears to spin
  forever.

## 4. Connections — simpler + MCP

- Trim to essentials: connected trackers (Linear/Jira) with connect/disconnect + the
  ticket-guidance box (`TicketPreferences`).
- New **MCP** section: advertise a Brief MCP server — "point any MCP-capable agent at Brief
  to read/file your briefs" with server URL + token (copy affordance). Documentation-style;
  no new backend required for v1 (informational + token surfacing).

## 5. Archive bug

- Investigate (systematic-debugging): likely the fire-and-forget POST failing silently or
  optimistic client state lost on `router.refresh()`/reload.
- Make archive **stick**: confirm the `archived_at` write lands, the feed query keeps
  excluding archived rows, and optimistic removal reconciles with server truth so an
  archived brief is never resurrected.

## 6. Extension

- **Create ticket:** remove the "Sending…/Sent + View on dashboard" pill flow. On click:
  fire the upload (`submitBrief`, keepalive), show a brief green **"Sent ✓ — opening your
  briefs…"**, open `${APP_URL}/briefs` in a new tab (via background `open-url`), close the bar.
- **Settings/param page removed:** delete `settings.html`/`settings.js` usage; replace with
  a **My briefs** button (opens `/briefs`). Keep connect/disconnect where it lives in the popup.

## Implementation phases

1. Nav + Dashboard (routes, Nav component, stats, remove hero).
2. Briefs list + fail-fast (elapsed, 90s timeout).
3. Connections + MCP + archive fix.
4. Extension (create-ticket redirect, My briefs button, drop settings page).

Each phase is verified in the live preview before moving on.

## Out of scope

- A real MCP server backend (v1 surfaces info/token only).
- Jira end-to-end verification (still pending an Atlassian connection).
- Charting libraries / analytics infra.
