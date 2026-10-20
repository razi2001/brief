# Activity tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record what people do in Brief Cloud and on get-brief.app in a first-party `events` table, and read it on `/admin/activity`.

**Architecture:** One `events` table. Server routes call `track()` (fire-and-forget through `after()`). Signed-in browser events go through `POST /api/events`; the marketing site beacons to the public `POST /api/t`, which validates origin, name, size and user agent. `/admin/activity` merges Clerk users, existing tables and events into a people funnel, a per-person timeline and a website summary.

**Tech Stack:** Next.js 16.2 (app router, `after`), Clerk 7, Supabase JS, Vitest 4, static HTML + Caddy for the site.

Spec: `docs/superpowers/specs/2026-10-20-activity-tracking-design.md`.

Commands run from `web/`. Tests: `npx vitest run <file>`. The worktree needs the
`node_modules` junction to the main checkout (`web/node_modules` →
`C:/Users/razif/src_perso/brief-cloud/web/node_modules`).

---

## File map

brief-cloud (`web/`):

| File | Responsibility |
|---|---|
| `supabase/migrations/0015_events.sql` | the table |
| `lib/events.ts` (+ test) | event names, `cleanProps`, `track`, `parseClientEvent` |
| `lib/site-events.ts` (+ test) | website beacon validation: origin, bot, device, fields |
| `lib/signup-source.ts` (+ test) | clean `?src&utm_*&ref` into Clerk `unsafeMetadata.signup` |
| `lib/activity.ts` (+ test) | pure: funnel, timeline lines, website summary |
| `lib/activity-server.ts` | loads Clerk users, tables and events for the admin pages |
| `app/api/t/route.ts` | public website beacon |
| `app/api/events/route.ts` | signed-in client events |
| `components/usage.ts` | client `sendEvent()` via `sendBeacon` |
| `components/PageViews.tsx` | `page.view` on each path change |
| `components/ActivityView.tsx`, `components/ActivityTimeline.tsx` | admin UI |
| `app/(main)/admin/activity/page.tsx`, `.../[userId]/page.tsx` | admin routes |
| hooks in existing routes | see Task 4 |

brief-marketing-website: `t.js` (new), `<script src="/t.js" defer>` in
`index.html`, `demo-sandbox.html`, `privacy.html`, `terms.html`, `404.html`;
one line in `privacy.html`.

---

### Task 1: events table and `track()`

**Files:** Create `web/supabase/migrations/0015_events.sql`, `web/lib/events.ts`, `web/lib/events.test.ts`

- [ ] **Step 1: Migration**

```sql
-- What people do in Brief Cloud and on get-brief.app, for the owner's
-- /admin/activity. user_id is the Clerk id; null for website visitors.
create table if not exists public.events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id text,
  name text not null,
  props jsonb not null default '{}'::jsonb
);
create index if not exists events_user_at_idx on public.events(user_id, at desc);
create index if not exists events_name_at_idx on public.events(name, at desc);
-- Service role only, like tracker_connections.
alter table public.events enable row level security;
```

- [ ] **Step 2: Failing tests** (`lib/events.test.ts`)

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const inserts = vi.hoisted(() => ({ rows: [] as unknown[], fail: false }));
vi.mock("@/lib/supabase/server", () => ({
  createAdminSupabase: () => ({
    from: () => ({
      insert: async (row: unknown) => {
        inserts.rows.push(row);
        return { error: inserts.fail ? { message: "down" } : null };
      },
    }),
  }),
}));
const afterMode = vi.hoisted(() => ({ throws: false }));
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    if (afterMode.throws) throw new Error("outside a request");
    return fn();
  },
}));

import { cleanProps, parseClientEvent, track } from "./events";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  inserts.rows = [];
  inserts.fail = false;
  afterMode.throws = false;
});

describe("cleanProps", () => {
  it("keeps flat scalars, caps strings, drops the rest", () => {
    expect(cleanProps({ a: "x".repeat(300), n: 3, b: true, o: { x: 1 }, u: undefined, z: null })).toEqual({
      a: "x".repeat(200),
      n: 3,
      b: true,
    });
  });
  it("keeps at most 12 keys", () => {
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(cleanProps(many))).toHaveLength(12);
  });
});

describe("track", () => {
  it("writes one row after the response", async () => {
    track("user_1", "tracker.connected", { provider: "linear" });
    await flush();
    expect(inserts.rows).toEqual([{ user_id: "user_1", name: "tracker.connected", props: { provider: "linear" } }]);
  });
  it("still writes outside a request", async () => {
    afterMode.throws = true;
    track(null, "site.view", { path: "/" });
    await flush();
    expect(inserts.rows).toHaveLength(1);
  });
  it("never throws when the insert fails", async () => {
    inserts.fail = true;
    expect(() => track("user_1", "brief.created")).not.toThrow();
    await flush();
  });
});

describe("parseClientEvent", () => {
  it("accepts the browser's names only", () => {
    expect(parseClientEvent({ name: "page.view", props: { path: "/tickets" } })).toEqual({
      name: "page.view",
      props: { path: "/tickets" },
    });
    expect(parseClientEvent({ name: "brief.filed" })).toBeNull();
    expect(parseClientEvent("nope")).toBeNull();
  });
});
```

- [ ] **Step 3: Run, expect FAIL** — `npx vitest run lib/events.test.ts` → cannot find `./events`.

- [ ] **Step 4: Implement** (`lib/events.ts`)

```ts
import { after } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";

/**
 * The owner's activity log (/admin/activity). Every name is listed here so a
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
```

- [ ] **Step 5: Run, expect PASS**, then commit `feat(web): events table and track()`.

### Task 2: website beacon validation and `/api/t`

**Files:** Create `web/lib/site-events.ts`, `web/lib/site-events.test.ts`, `web/app/api/t/route.ts`; modify `web/proxy.ts`.

- [ ] **Step 1: Failing tests** (`lib/site-events.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { deviceOf, isBot, parseSiteEvent } from "./site-events";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const ok = { origin: "https://get-brief.app", ua: CHROME, dev: false };

describe("parseSiteEvent", () => {
  it("keeps the known fields of a known event and adds the device", () => {
    const raw = JSON.stringify({ name: "site.view", props: { path: "/", ref: "linkedin.com", pv: "abc", junk: "x" } });
    expect(parseSiteEvent(raw, ok)).toEqual({
      name: "site.view",
      props: { path: "/", ref: "linkedin.com", pv: "abc", device: "desktop" },
    });
  });
  it("refuses other origins, unknown names, bots, big bodies and bad JSON", () => {
    const raw = JSON.stringify({ name: "site.click", props: { target: "signup" } });
    expect(parseSiteEvent(raw, { ...ok, origin: "https://evil.example" })).toBeNull();
    expect(parseSiteEvent(raw, { ...ok, origin: null })).toBeNull();
    expect(parseSiteEvent(JSON.stringify({ name: "brief.filed" }), ok)).toBeNull();
    expect(parseSiteEvent(raw, { ...ok, ua: "Googlebot/2.1" })).toBeNull();
    expect(parseSiteEvent("x".repeat(3000), ok)).toBeNull();
    expect(parseSiteEvent("{", ok)).toBeNull();
  });
  it("accepts www and, in development only, localhost", () => {
    const raw = JSON.stringify({ name: "site.demo", props: { act: "start" } });
    expect(parseSiteEvent(raw, { ...ok, origin: "https://www.get-brief.app" })).not.toBeNull();
    expect(parseSiteEvent(raw, { ...ok, origin: "http://localhost:8080" })).toBeNull();
    expect(parseSiteEvent(raw, { ...ok, origin: "http://localhost:8080", dev: true })).not.toBeNull();
  });
});

describe("isBot / deviceOf", () => {
  it("spots bots and empty agents", () => {
    expect(isBot("")).toBe(true);
    expect(isBot("HeadlessChrome/141")).toBe(true);
    expect(isBot(CHROME)).toBe(false);
  });
  it("tells mobile from desktop", () => {
    expect(deviceOf(IPHONE)).toBe("mobile");
    expect(deviceOf(CHROME)).toBe("desktop");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`lib/site-events.ts`)

```ts
import { cleanProps, type Props, type SiteEvent } from "@/lib/events";

/** The marketing site. Anything else posting to /api/t is dropped. */
export const SITE_ORIGINS = ["https://get-brief.app", "https://www.get-brief.app"];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

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
  if (typeof name !== "string" || !(name in FIELDS)) return null;
  const given = props && typeof props === "object" ? (props as Record<string, unknown>) : {};
  const kept = Object.fromEntries(FIELDS[name as SiteEvent].filter((k) => k in given).map((k) => [k, given[k]]));
  return { name: name as SiteEvent, props: { ...cleanProps(kept), device: deviceOf(req.ua) } };
}
```

- [ ] **Step 4: Route** (`app/api/t/route.ts`)

```ts
import { NextRequest } from "next/server";
import { track } from "@/lib/events";
import { parseSiteEvent } from "@/lib/site-events";

/**
 * get-brief.app's cookieless beacon (navigator.sendBeacon, text/plain, so no
 * preflight). Always 204: a refused event tells the sender nothing.
 */
export async function POST(req: NextRequest) {
  const event = parseSiteEvent(await req.text().catch(() => ""), {
    origin: req.headers.get("origin"),
    ua: req.headers.get("user-agent") ?? "",
    dev: process.env.NODE_ENV !== "production",
  });
  if (event) track(null, event.name, event.props);
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 5: `proxy.ts`** — add `"/api/t"` to `isPublic` and a comment line: `/api/t is get-brief.app's page-view beacon (no session; app/api/t checks the origin).`

- [ ] **Step 6: Run tests, expect PASS; commit** `feat(web): /api/t beacon for get-brief.app`.

### Task 3: signed-in client events

**Files:** Create `web/app/api/events/route.ts`, `web/components/usage.ts`, `web/components/PageViews.tsx`; modify `web/app/(main)/layout.tsx`, `web/components/Onboarding.tsx`, `web/components/onboarding/TryItDemo.tsx`.

- [ ] **Step 1: Route**

```ts
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { parseClientEvent, track } from "@/lib/events";

/** Page views, onboarding steps and in-app demo clicks from a signed-in browser. */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return new Response(null, { status: 401 });
  const event = parseClientEvent(await req.json().catch(() => null));
  if (!event) return new Response(null, { status: 400 });
  track(userId, event.name, event.props);
  return new Response(null, { status: 204 });
}
```

`sendBeacon` posts text/plain; `req.json()` parses the body regardless of content type.

- [ ] **Step 2: `components/usage.ts`**

```ts
import type { ClientEvent } from "@/lib/events";

/** Fire-and-forget; sendBeacon survives the page navigating away. */
export function sendEvent(name: ClientEvent, props: Record<string, string | number | boolean> = {}): void {
  try {
    const body = JSON.stringify({ name, props });
    if (navigator.sendBeacon?.("/api/events", body)) return;
    void fetch("/api/events", { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {
    /* tracking never breaks the page */
  }
}
```

`lib/events.ts` imports `next/server` and Supabase; importing only its type keeps them out of the client bundle (`import type`).

- [ ] **Step 3: `components/PageViews.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { sendEvent } from "./usage";

/** One page.view per path the signed-in app shows. */
export default function PageViews() {
  const path = usePathname();
  useEffect(() => {
    if (path) sendEvent("page.view", { path });
  }, [path]);
  return null;
}
```

Render `<PageViews />` inside `MainLayout` (before `{children}`).

- [ ] **Step 4: Onboarding** — in `components/Onboarding.tsx` after `const step = ...`:

```tsx
  // The activity log's onboarding steps: where a new user stops.
  useEffect(() => {
    if (isLoaded || rawStep !== null) sendEvent("onboarding.step", { step });
  }, [step, isLoaded, rawStep]);
```

(Skips the loading skeleton, where `step` is still a guess.)

- [ ] **Step 5: TryItDemo** — in its existing mount `useEffect` that calls `initDemo(root, …)`, add a capture-phase listener on the same root:

```tsx
    // Each demo button once per mount, for the activity log.
    const seen = new Set<string>();
    const onAct = (e: Event) => {
      const act = (e.target as Element | null)?.closest?.("[data-act]")?.getAttribute("data-act");
      if (!act || seen.has(act)) return;
      seen.add(act);
      sendEvent("onboarding.demo", { act });
    };
    root.addEventListener("click", onAct, true);
```

and `root.removeEventListener("click", onAct, true)` in its cleanup. The existing `TryItDemo.test.tsx` must still pass (mock `../usage` if it complains about `navigator.sendBeacon`).

- [ ] **Step 6:** `npx vitest run components` and `npx tsc --noEmit`; commit `feat(web): page views, onboarding steps and demo clicks`.

### Task 4: server events in existing routes

Each is one `track(...)` call after the success (or failure) is known. Import `{ track } from "@/lib/events"`.

| File | Where | Call |
|---|---|---|
| `app/api/settings/route.ts` | after `updateUserMetadata` succeeds | `if ("role" in updates \|\| "source" in updates) track(userId, "onboarding.about", { role: updates.role, source: updates.source });` and `if (updates.onboardedAt) track(userId, "onboarding.finished");` |
| `app/api/extension-token/route.ts` | after insert succeeds | `track(userId, "extension.paired")` |
| `app/api/me/route.ts` | after the Clerk user loads | `track(userId, "extension.opened")` |
| `app/api/briefs/route.ts` | after the row insert succeeds | `track(userId, "brief.created", { kind: sourceKind ?? "unknown" })` |
| `app/api/briefs/[id]/process/route.ts` | in the `!tracker` branch | `track(userId, "brief.file_refused", { reason: "no_tracker" })` |
| `lib/agent/run-processing.ts` `processBriefById` | no tracker / filed / catch | `brief.failed {stage:"file", error}`, `brief.filed {provider: tracker.kind}`, `brief.failed {stage:"file", error}` |
| same, `draftBriefById` | ok / catch | `brief.drafted`, `brief.failed {stage:"draft", error}` |
| `app/api/briefs/[id]/retry/route.ts` | after the claim succeeds | `track(userId, "brief.retry")` |
| `app/api/briefs/[id]/archive/route.ts` | before `ok` | `track(userId, "brief.archived")` |
| `app/api/briefs/[id]/delete/route.ts` | before the final `ok` | `track(userId, "brief.deleted")` |
| `app/api/connect/[provider]/start/route.ts` | before the final redirect | `track(userId, "tracker.connect_start", { provider })` |
| `app/api/connect/[provider]/callback/route.ts` | both `record` helpers (GET, POST) and both success returns | `record` becomes `(code, why = {}) => { track(userId, "tracker.connect_failed", { provider, code, reason: why.reason ?? "" }); return errorCookie(...); }`; success: `if (!outcome.failure) track(userId, "tracker.connected", { provider })` |
| `app/api/connect/[provider]/disconnect/route.ts` | before `ok` | `track(userId, "tracker.disconnected", { provider })` |

Errors are capped by `cleanProps` (200 chars); error strings are Brief's own messages, no tokens.

- [ ] Steps: add the calls, run `npx vitest run` (whole suite; routes that mock `@/lib/supabase/server` must still pass because `track` swallows every failure), `npx tsc --noEmit`, commit `feat(web): record onboarding, tracker, extension and brief events`.

### Task 5: sign-up source

**Files:** Create `web/lib/signup-source.ts` + test; modify `web/app/sign-up/[[...sign-up]]/page.tsx`.

- [ ] **Test**

```ts
import { describe, expect, it } from "vitest";
import { signupSource } from "./signup-source";

describe("signupSource", () => {
  it("keeps the known params, trimmed and capped", () => {
    expect(signupSource({ src: "hero", utm_source: "linkedin", ref: "www.linkedin.com", x: "y" })).toEqual({
      src: "hero",
      utm_source: "linkedin",
      ref: "www.linkedin.com",
    });
    expect(signupSource({ src: "a".repeat(100) })?.src).toHaveLength(60);
  });
  it("is null with nothing to keep, and takes the first of repeated params", () => {
    expect(signupSource({})).toBeNull();
    expect(signupSource({ src: ["nav", "hero"] })).toEqual({ src: "nav" });
  });
});
```

- [ ] **Implement**

```ts
/** Where a sign-up came from: get-brief.app adds these to its sign-up links. */
const KEYS = ["src", "utm_source", "utm_medium", "utm_campaign", "ref"] as const;
export type SignupSource = Partial<Record<(typeof KEYS)[number], string>>;

export function signupSource(params: Record<string, string | string[] | undefined>): SignupSource | null {
  const out: SignupSource = {};
  for (const k of KEYS) {
    const raw = params[k];
    const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 60);
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}
```

- [ ] **Page** — make it `async ({ searchParams })`, `const signup = signupSource(await searchParams);` and pass `unsafeMetadata={signup ? { signup } : undefined}` to `<SignUp>`. Commit `feat(web): keep the sign-up's source on the Clerk user`.

### Task 6: `/admin/activity`

**Files:** Create `web/lib/activity.ts` + test, `web/lib/activity-server.ts`, `web/components/ActivityView.tsx`, `web/components/ActivityTimeline.tsx`, `web/app/(main)/admin/activity/page.tsx`, `web/app/(main)/admin/activity/[userId]/page.tsx`; modify `web/components/Nav.tsx`, `web/components/SidebarInfo.tsx`.

`lib/activity.ts` (pure, tested):
- `FUNNEL = ["about", "tracker", "extension", "brief", "filed"]` and `funnelOf(state)` from current state (works for people who signed up before tracking): about = role or source saved; tracker = a `tracker_connections` row or a Clerk tracker account; extension = an extension token; brief = any brief; filed = any brief with a ticket url.
- `lineOf(event)`: one human line per event name (`tracker.connected` → `Connected Linear`, `page.view` → `Opened /tickets`, `onboarding.step` → `Onboarding: tracker step`, `brief.failed` → `Brief failed: <error>` …).
- `timelineOf({ signedUpAt, signup, events, tokens, briefs, since })`: Clerk sign-up first (with its source), events, and for history before `since` (the first event ever recorded) synthetic lines from `extension_tokens` and `briefs`; newest first.
- `siteSummary(events, now, days)`: views, visits (distinct `pv`), top `ref` hosts, top `utm_source`, clicks per `target`, and demo funnel (distinct `pv` per `act`, in the demo's order).

Tests cover each function with small fixtures (funnel for a user with only a token, timeline merge order and the `since` cut, summary counts and visit dedupe).

`lib/activity-server.ts`: `loadPeople()` (Clerk `getUserList` ordered `-created_at`, limit 500, plus `extension_tokens`, `tracker_connections`, `briefs` user ids/status, last event per user) → rows for the list; `loadPerson(userId)`; `loadSiteEvents(days)` (`name like 'site.%'`, `at > now - days`, limit 50000).

Pages call `requireAdmin()` first. `ActivityView` shows the website summary (7 / 30 day toggle) above the people list; each person links to `/admin/activity/<id>`. `ActivityTimeline` lists the timeline. Nav gets an `ActivityNavLink` ("Activity") rendered next to `AdminNavLink` in `SidebarAdminLink`.

- [ ] Steps: tests first for `lib/activity.ts`, implement, then server loader and UI, `npx tsc --noEmit`, `npx vitest run`, commit `feat(web): /admin/activity`.

### Task 7: privacy wording

- [ ] `app/privacy/page.tsx`: the short version's "we do not run any advertising or analytics trackers" becomes "we keep a first-party log of what you do in the web app and which Brief features the extension calls, to improve Brief; no advertising or third-party analytics trackers". Add to "What we collect" a short item for the usage log (pages opened, trackers connected, briefs created and filed; kept in our database, never shared). The extension bullet ("No analytics or telemetry SDKs in the extension") stays. Commit `docs(web): privacy page names the usage log`.

### Task 8: marketing site (`brief-marketing-website`)

- [ ] **`t.js`** (served at `/t.js`):

```js
/* Cookieless counts for get-brief.app: page views, button clicks and the
   live demo's steps. Nothing is stored in the browser; `pv` lives in memory
   for one page load. */
(function () {
  var END = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? 'http://localhost:3000/api/t'
    : 'https://cloud.get-brief.app/api/t';
  var pv = Math.random().toString(36).slice(2, 10);
  var q = new URLSearchParams(location.search);
  var ref = '';
  try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
  if (ref === location.hostname) ref = '';

  function send(name, props) {
    props.pv = pv;
    var body = JSON.stringify({ name: name, props: props });
    try { if (navigator.sendBeacon && navigator.sendBeacon(END, body)) return; } catch (e) {}
    try { fetch(END, { method: 'POST', body: body, keepalive: true, mode: 'no-cors' }); } catch (e) {}
  }

  var view = { path: location.pathname, ref: ref };
  ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function (k) { if (q.get(k)) view[k] = q.get(k); });
  send('site.view', view);

  function where(el) {
    var s = el.closest('[id], nav, footer');
    return !s ? '' : s.id || s.tagName.toLowerCase();
  }

  // Sign-up links carry where they were clicked and where the visitor came
  // from, so the new account's timeline starts there.
  document.querySelectorAll('a[href^="https://cloud.get-brief.app/sign-up"]').forEach(function (a) {
    var u = new URL(a.href);
    u.searchParams.set('src', where(a) || 'page');
    ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function (k) { if (q.get(k)) u.searchParams.set(k, q.get(k)); });
    if (ref) u.searchParams.set('ref', ref);
    a.href = u.toString();
  });

  var demoSeen = {};
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : e.target.parentElement;
    if (!t) return;
    var act = t.closest('#try [data-act]');
    if (act) {
      var name = act.getAttribute('data-act');
      if (!demoSeen[name]) { demoSeen[name] = 1; send('site.demo', { act: name }); }
      return;
    }
    var a = t.closest('a, button[data-video]');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var target =
      /cloud\.get-brief\.app\/sign-up/.test(href) ? 'signup' :
      /chromewebstore\.google\.com/.test(href) ? 'chrome' :
      a.hasAttribute('data-video') ? 'video' :
      /demo-sandbox/.test(href) ? 'sandbox' : '';
    if (target) send('site.click', { target: target, where: where(a) });
  }, true);
})();
```

- [ ] Add `<script src="/t.js" defer></script>` before `</body>` in `index.html`, `demo-sandbox.html`, `privacy.html`, `terms.html`, `404.html` (not `pricing.html`, which redirects at once).
- [ ] `privacy.html`: one line saying the website counts page views and button clicks without cookies or any stored id, through Brief's own server.
- [ ] Commit on a branch `cookieless-counts`.

### Task 9: verify

- [ ] `npx vitest run`, `npx tsc --noEmit`, `npm run lint` in `web/`.
- [ ] Run `web` locally (`npm run dev` via the preview tool), serve the marketing site on `localhost:8080`, open `index.html` in headless Chrome, click Sign up, start the demo, and confirm the `/api/t` requests answer 204 (events go to the shared DB only after the migration is applied, so this checks the request path; the DB write is checked after the migration).

### Task 10: PRs

- [ ] brief-cloud: push branch, open PR with `GH_TOKEN=$(gh auth token -u razi2001)`.
- [ ] brief-marketing-website: push `cookieless-counts`, open PR.
- [ ] Ask before applying `0015_events.sql` (IPv4 pooler, see memory), merging or deploying.
