# Podium hats, tracker picker, team list

Date: 2026-09-24
Status: approved ("go merge")

## Why

Three asks from one message:

1. **"Make the crown more funny."** The leader's crown is a 16px `♔` glyph.
2. **"Better UI for the integrations, not a list of all of them, maybe a dropdown."**
   `/connections` stacks three tracker cards, though Brief files into exactly one.
3. **"See other team members in the same org in settings."** Today the org shows
   up only as a count ("5 people") on Team defaults, and as the podium.

## 1. Podium hats

Picked from three mockups: a mix of B (googly crown) and C (hat party).

| Place | Hat | Motion |
|---|---|---|
| 1st | googly-eyed crown, tilted -6deg | pupils follow the pointer, blinks every 2.5 to 6s |
| 2nd | party cone (violet, white stripes, orange pom-pom) | gentle bob |
| 3rd | paper crown | gentle bob |
| 4th and below (list rows) | none | none |

- The hat follows `entry.rank`, not the column index: the podium renders 2nd, 1st, 3rd.
- The solo card wears the crown. A two-person podium gets the crown and the party hat.
- `prefers-reduced-motion: reduce`: no bob, no blink, pupils stay centered.
- Hats are decorative (`aria-hidden`).
- Unchanged: the brag bubble, earned titles, the range toggle, the "bronze is N bugs away" nudge.
- Units: `web/components/PodiumHats.tsx` (the three SVGs and the eye tracking),
  `web/lib/googly.ts` (pure `pupilOffset`), a `hat-bob` keyframe in `globals.css`.

## 2. Tracker picker

One card replaces the list of three.

- The trigger shows the selected tracker's logo, name and a chevron, and opens a
  listbox: logo, name, caption, a "connected" marker, a check on the selection.
- Selecting only previews. The buttons act:

| State | Right side of the card |
|---|---|
| selected is connected, healthy | `Connected ✓` pill, Disconnect |
| selected is connected, stale grant | `Reconnect needed` pill, Reconnect → |
| nothing connected | Connect {name} → |
| another tracker is connected | Cancel, Switch to {name} → (title names the one it disconnects) |
| nothing selected yet | the trigger reads "Choose a tracker" |

- Initial selection: the connected tracker, else the one with a pending or failed
  attempt (so its error is on screen after the OAuth round trip), else none.
- Errors, pending-verification copy and the account-settings fallback are shown for
  the selected tracker, with today's wording.
- Keyboard: Enter, Space or ArrowDown opens; arrows move; Enter selects; Escape
  closes and returns focus to the trigger; an outside click closes.
- Split: `TrackerPicker.tsx` is presentational (props only, no Clerk);
  `Integrations.tsx` stays the container (Clerk, the health fetch, the fallback).
- The onboarding wizard keeps its three buttons: a first choice is where seeing
  every option helps.
- Rejected: switching on select (one mis-click disconnects the current tracker and
  redirects to OAuth), and a native `<select>` (no logos).

## 3. Team list

A **Team** section on `/connections`, between the tracker and Ticket preferences.

- Sub-line: `{org} on {Provider} · N people`, or `just you so far` when alone.
- Rows: avatar, full name, `you`, the earned all-time title, the all-time ticket
  count (`1 ticket`, `N tickets`).
- Order: you first, then full name A to Z, case-insensitive.
- No emails: the org can be a GitHub org, where people keep theirs private.
- Hidden when the viewer has no org.
- Scrolls past about eight rows.
- Data: `getOrgTeam(orgKey, viewerId)` in `org-server.ts`. Members from
  `org_members`, counts from the existing `org_leaderboard` RPC (all time), titles
  from `rankReporters`, names from one Clerk `getUserList` (`lookupNames` gains
  `fullName`). Same roster as the podium, by construction.
- Units: `web/lib/team.ts` (pure `sortTeam`), `web/components/TeamList.tsx`.

## 4. Connections becomes Settings

- The nav label and the page title read **Settings**. The URL stays `/connections`:
  it is the OAuth `redirectUrl`, and other pages link to it.
- User-facing errors that say "under Connections" or "in Connections" say
  "Settings" (`registry.ts` twice, `linear.ts`, `github.ts`, `run-processing.ts`).

## Testing

- Unit: `pupilOffset`, `sortTeam`.
- Component (jsdom): hats by rank for three, two and one person; the eyes follow a
  pointermove and stay put under reduced motion; every TrackerPicker state and its
  keyboard path; TeamList order and labels.
- Gates: `tsc --noEmit`, `vitest run`, eslint on changed files, `next build --webpack`.
- Visual: headless screenshots of a temporary dev-only preview page (not committed)
  rendering all three with fixtures, since local dev cannot resolve an org.

## Out of scope

Invites, member management, showing emails, changing onboarding, hats past 3rd place.
