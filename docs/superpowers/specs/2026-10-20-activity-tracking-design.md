# Activity tracking: the app and the marketing site

Date: 2026-10-20. Status: design approved by Razi.

## Goal

See what people do in Brief, so a sign-up like someone from an agency
(signed up, paired the extension, never connected a tracker, left after a
minute) can be read as a timeline instead of pieced together from Clerk and
table rows. Also see what visitors do on get-brief.app, including how far they
get in the interactive demo, and which button and referrer a sign-up came from.

Fly keeps only the last few dozen log lines, so stdout logging is not enough:
events go to a table.

## Decisions

- First-party only: an `events` table in the shared Supabase DB and an admin
  page. No PostHog, no third-party script, no cookie banner.
- The extension sends nothing new. The privacy page promises no telemetry in
  the extension; the server records the calls the extension already makes.
- The marketing site is cookieless: nothing stored in the browser. A random id
  lives in memory for one page load, so one visit's demo steps group together.

## Storage

Migration `0015_events.sql`:

| column | type | notes |
|---|---|---|
| id | bigint identity | primary key |
| at | timestamptz | default now() |
| user_id | text | Clerk id; null for website visitors |
| name | text | e.g. `tracker.connected`, `site.view` |
| props | jsonb | default `{}` |

Indexes on `(user_id, at desc)` and `(name, at desc)`. RLS on with no
policies: only the service-role client reads or writes it.

## App events (brief-cloud)

One server helper, `track(userId, name, props)` in `web/lib/events.ts`. It runs
after the response (`after()` from `next/server`), never throws and never
delays a request. Names are a closed list in code.

| Area | Events | Recorded in |
|---|---|---|
| Onboarding | `onboarding.about` {role, source}, `onboarding.step` {step}, `onboarding.finished` | settings route; client endpoint |
| Trackers | `tracker.connect_start`, `tracker.connected`, `tracker.connect_failed` {reason}, `tracker.disconnected` (all {provider}) | `/api/connect/[provider]/*` |
| Extension | `extension.paired`, `extension.opened` | `/api/extension-token`, `/api/me` (bearer) |
| Briefs | `brief.created` {kind}, `brief.file_refused` {reason}, `brief.filed` {provider}, `brief.drafted`, `brief.failed` {stage, error}, `brief.retry`, `brief.archived`, `brief.deleted` | brief routes, processing |
| Pages | `page.view` {path} | client endpoint |
| Demo | `onboarding.demo` {act}, once per act per mount | client endpoint |

Client-side events (page views, onboarding steps, the in-app demo) go through
`POST /api/events`, which requires a Clerk session and accepts only the client
names above.

## Website events (brief-marketing-website)

A small inline script on every page sends `navigator.sendBeacon` to
`https://cloud.get-brief.app/api/t` (text/plain, so no CORS preflight):

- `site.view` {path, ref (host only), utm_source, utm_medium, utm_campaign, device, pv}
- `site.click` {target: signup | chrome | video | sandbox, where: section id, pv}
- `site.demo` {act, pv}: each `data-act` button in the hero demo, once per act
  per page load.

`/api/t` is public. It accepts only `Origin` https://get-brief.app or
https://www.get-brief.app, only the three names above, bodies under 2 KB, and
drops user agents that look like bots. It stores no IP. `user_id` is null.

## Visit to sign-up

Sign-up buttons on the site add `src=<where>` plus the page's utm tags and
referrer host to the `/sign-up` link. The `/sign-up` page passes them to
`<SignUp unsafeMetadata={{ signup: {...} }}>`, which Clerk copies onto the new
user (email code and Google alike). The admin timeline shows them as the first
line.

## Admin: `/admin/activity`

Admin-only (`requireAdmin()`), linked from `/admin`.

- People, newest sign-up first: name/email, sign-up date and source, a funnel
  row (about you, tracker, extension, first brief, filed), last seen. A person
  opens their full timeline: Clerk sign-up first, then their events.
- Website, last 7 and 30 days: views, top referrers and utm sources, clicks per
  target, and the demo funnel by act (visits that reached each act).

## Privacy wording

- App privacy page: "we do not run any advertising or analytics trackers"
  becomes a first-party usage log of what you do in Brief Cloud, no
  third-party trackers, no cookies for it. The extension bullet stays.
- Marketing privacy page: one line on cookieless page and click counts.

## Testing

- Unit: event name allow-lists, `/api/t` checks (origin, bot, size, names),
  `/api/events` auth and names, the funnel and website aggregation.
- Headless Chrome against the local marketing site: page view, a CTA click and
  demo acts reach a local `/api/t`.

## Rollout

Two PRs, one per repo. The migration is additive; apply it to the shared DB,
merge and deploy only on Razi's go. Until the app is deployed, the site's
beacons fail silently.
