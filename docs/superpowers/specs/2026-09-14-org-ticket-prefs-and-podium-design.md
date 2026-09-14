# Org ticket preferences + top reporters podium

Date: 2026-09-14
Status: proposed

## Why

Two problems, one shared missing concept.

1. **Ticket prefs are configured per person.** Today `ticketGuidance` is a single
   free-text string on the Clerk user's `privateMetadata`, edited on
   `/connections` and read by the agent at filing time. Every teammate
   configures the same routing rules from scratch, and when they don't, Brief
   files tickets into the wrong place or the wrong status.
2. **Nobody can see who is actually reporting.** Brief has no notion of a team,
   so there is no way to see the shape of reporting across one.

Both need the same thing Brief has never had: an **organization**.

## What an org is

> "People who share the same Linear / same GitHub etc."

An org is a **tracker workspace**. Two Brief users are in the same org when
their connected tracker points at the same workspace. Nothing is invited,
created, or administered - membership is a fact about the tracker token, proven
server-side.

Org key format is `provider:id`:

| Provider | Key | How it resolves | Ambiguity |
|---|---|---|---|
| Linear | `linear:<organization.id>` | GraphQL `query { organization { id name urlKey } }` | None - one workspace per token |
| Jira | `jira:<cloudId>` | `getJiraCloud()` already returns `cloudId` | None - one site per token |
| GitHub | `github:<org login>` | **The user picks once** from `/user/orgs` | A GitHub user belongs to many orgs at once |

GitHub is the only provider that asks. `listTargets` already pulls repos across
`owner,collaborator,organization_member`, so there is genuinely no single
"their" org to infer. The picker appears on `/connections` under the GitHub
card and stores the choice; until it is answered, a GitHub-only user simply has
no org (personal prefs only, no podium) - never a wrong one.

A user with no tracker connected has no org. That is a normal state, not an
error.

## Precedence

```
personal override (when mode = "override")  ->  wins outright
org default                                  ->  otherwise
""                                           ->  when neither exists
```

The personal override **replaces** the org default. It is never merged or
concatenated - the whole point is "ignore the org one".

### Inherit vs override is explicit

Precedence keys off an explicit `ticketGuidanceMode: "inherit" | "override"`,
not off the text being empty. Emptiness is ambiguous in a way that would bite:
a user who clears their box cannot tell whether they just fell back to the team
rules or silently opted into "no rules at all". A two-state toggle - *use team
defaults* / *use my own* - answers that on the surface, and makes a deliberate
"override with nothing" expressible.

### Migration is free

Existing users all have a non-empty personal `ticketGuidance` and no org
default. They are migrated to `mode = "override"`, which makes their effective
guidance byte-identical to today. Nobody's filing behaviour changes on deploy.
Users with empty guidance start at `mode = "inherit"`.

## Storage

Personal override stays on Clerk `privateMetadata` (`ticketGuidance` plus the
new `ticketGuidanceMode`) - it is already there and already per-user.

Org-level state is relational and shared, so it goes in Supabase:

```sql
-- 0010_orgs.sql
create table public.org_members (
  user_id     text primary key,
  org_key     text not null,
  org_name    text not null,
  provider    text not null,
  resolved_at timestamptz not null default now()
);
create index org_members_org_idx on public.org_members(org_key);

create table public.org_settings (
  org_key         text primary key,
  ticket_guidance text not null default '',
  updated_at      timestamptz not null default now(),
  updated_by      text,
  updated_by_name text
);
```

`updated_by_name` is denormalized so "last changed by X" renders without a
Clerk round trip.

### Membership refresh

Resolving an org key costs a tracker API call, so it is cached in `org_members`
and refreshed when missing or older than 24h. Refresh is best-effort and never
blocks a render: on failure we use the cached row, and on no cached row the
user simply has no org this request. This matches the existing convention in
`getTrackerContext` and `resolveTracker`, both of which degrade rather than
throw.

## Confirming a change to team defaults

Saving the **org** default opens a confirmation dialog. Saving a **personal
override** does not - it only affects you.

The dialog has to earn its interruption, so it states the blast radius and
shows exactly what changes:

- "Change defaults for N people" - the real member count
- one line on who is affected: everyone in the org without their own override
- a **line-level diff** of the guidance, removals in red and additions in green
- Cancel / "Update for everyone"

The diff comes from a small pure `lib/text-diff.ts` (LCS over lines, no
dependency), unit-tested.

## Top reporters podium

A dashboard section, scoped to the viewer's org, ranking people by **tickets
filed** (`status = 'filed'`, not archived). Filed is the metric the rest of the
dashboard already centers on, and it can't be inflated by abandoned drafts.

- **Default range: past month.** "All time" is the alternate, via a segmented
  control.
- Top 3 render as an actual podium - 1st centre and tallest, crowned.
- Ranks 4+ render as a compact list underneath.
- The viewer's own row is marked "you".
- **Hidden entirely when fewer than 2 org members have at least one filed
  ticket in the selected range.** A podium of one is a sad object. Note this is
  evaluated per range, so an org can show "all time" and hide "past month".

### The funny part

The gag is that every title is *earned from real data*, so it is true as well
as silly. One title per person, assigned by priority so they never collide:

| Title | Earned by |
|---|---|
| chief bug officer | rank 1 |
| the closer | rank 2 |
| the night shift | most briefs created between 22:00 and 06:00 |
| the novelist | longest average ticket title |
| on a tear | biggest jump vs the previous month |
| still warming up | fewest briefs, but at least one |

Plus a speech bubble over the leader with a dry one-liner, and a nudge line
under the list for whoever is just off the podium ("bronze is two bugs away.").

All of it derives from columns `briefs` already has - `user_id`, `created_at`,
`title`, `status`. No new capture.

**Tone guardrail:** the jokes point up, never down. The leader gets ribbed; the
bottom of the list gets "still warming up", never a wooden spoon. A leaderboard
between colleagues should be fun for the person in last place too.

### Query

Aggregation runs as a Postgres RPC so it stays one round trip regardless of org
size:

```sql
create function public.org_leaderboard(member_ids text[], since timestamptz)
returns table (
  user_id    text,
  filed      bigint,
  night      bigint,  -- filed between 22:00 and 06:00, for "the night shift"
  avg_title  numeric, -- mean ticket title length, for "the novelist"
  prev_filed bigint   -- filed in the preceding window, for "on a tear"
)
```

`since = null` means all time. The three extra columns exist so the title
assignment needs no second query.

Display names and avatars come from one batched
`clerkClient.users.getUserList({ userId: [...] })`.

## Security

This is the app's first cross-tenant read. `0001_init.sql` records that there
is no RLS and that every access is "scoped by `user_id` in code" - that
invariant is changing, so the new rules are explicit:

1. The org key is **always** derived server-side from a live tracker token.
   It is never read from a request body, query param, or client state. A
   client that could name its own org could read any org's leaderboard.
2. Every org read and write re-resolves the caller's membership first and
   operates only on the org that resolution returns.
3. The podium exposes display name, avatar, and filed count to fellow org
   members only - deliberate, and the minimum the feature needs.
4. Anyone in an org can edit its defaults, gated by the confirmation dialog.
   That is what was asked for. Worth flagging: the trackers give us no reliable
   admin/role signal, so the dialog is a speed bump rather than a permission.
   If that proves too loose, the natural follow-up is to gate edits on a
   tracker-side admin flag where the provider exposes one.

## Testing

Pure units, colocated with the existing `*.test.ts` convention:

- `lib/org.test.ts` - key formatting/parsing, per-provider resolution against
  mocked adapters, the no-org and unresolved-GitHub paths
- `lib/guidance.test.ts` - precedence across all four combinations, and the
  migration mapping
- `lib/text-diff.test.ts` - line diff: additions, removals, unchanged, empty
  sides
- `lib/podium.test.ts` - ranking, tie-breaks, range filtering, title
  assignment priority and no-collision
- A component test for the confirm dialog gating the org save, following
  `TicketAssistant.undo.test.tsx`

## Out of scope

- Clerk Organizations, invites, roles, an org switcher
- Per-target (per-team, per-repo) preferences
- Structured preference fields - guidance stays free text
- Cross-org membership: one user, one org, the one their tracker resolves to
