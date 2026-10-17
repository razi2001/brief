# Onboarding step 4: Try it

Date: 2026-10-17. Status: design approved by Razi.

## Goal

A new user learns how to use Brief inside onboarding, in about a minute, with the
same interactive demo as the get-brief.app hero (both planted bugs), then gets a
link to the in-app Guide. Nothing else.

The rule for every choice below: onboarding must feel natural, easy and quick,
with no extra friction.

## Friction rules

1. Nothing in step 4 is required. "All set, take me home" is visible the whole time.
2. No start gate. Step 4 opens straight on the "Bug 1 of 2" intro card: the user
   already chose to come here, so the website's "Start the interactive demo" click
   is dropped.
3. Step 3: once the extension is connected, its "Continue" is the primary (accent)
   button, so the next move is obvious.
4. Labels only, no instructional paragraphs. Step 4's one subtitle is
   "Report two bugs. About a minute." because the time cost is what a user needs
   to decide to try it.
5. The demo's own pacing stays as on the website (the 3.5 s move from bug 1 to
   bug 2, "Let's go" skips it).

## The steps

- Rail: You · Tracker · Extension · Try it.
- Step 3 footer: Back (when no tracker is connected, as today) and "Continue" (accent
  once the extension is connected, plain before). It no longer finishes onboarding.
- Step 4: title "Try it", the subtitle above, then the demo. Footer: Back and
  "All set, take me home" (the existing `finish()`: saves `onboardedAt`, goes to
  `/dashboard`).
- "Skip setup, straight home" shows on steps 1 to 3 (today it hides on the
  extension step; now it hides only on step 4, whose footer already finishes).
- The derived starting step (`autoStep`) is unchanged: onboarding never lands on
  step 4 by itself.
- Width: steps 1 to 3 keep `max-w-[560px]`. Step 4 widens the sheet to
  `max-w-[880px]`. On phones the demo stacks and scales as it does on the website.

## The demo

Approach: port the website demo as is (approach A). It is the same experience
because it is the same markup, CSS and state machine. The cost is a second copy;
the website stays the source of truth for the demo's look.

Source: `C:\Users\razif\src_perso\brief-marketing-website\index.html` at commit
`4e55799` (read only, do not edit that repo):
- markup: the hero demo window (the `.win` inside `#try`), including the popup,
  screenshot layer, recording bar and ticket view;
- CSS: the "interactive demo" block (about lines 208 to 566);
- JS: `initDemo` and its helpers (about lines 1508 to 2200);
- the SVG symbols it references: `mark`, `lg-linear`, `lg-jira`, `lg-github`,
  `lg-acme`, `i-chev`, `i-arrow`, `i-reset`, `i-mic`, `i-x`, `i-video`, `i-shot`,
  `i-replay`, `i-reload`, `i-puzzle`, `i-pointer`, `i-plus`, `i-lock`, `i-fwd`,
  `i-cloud`, `i-check`, `i-back`, `i-alert` (drop any that only the removed parts used).

Target:
- `web/components/onboarding/TryItDemo.tsx` ("use client"), loaded only on step 4.
- `web/components/onboarding/try-it-demo.css`, every rule scoped under the
  `.try-demo` root. Any `:root`/`body` rule or design token the demo relies on
  (`--acc` and friends) is redefined on `.try-demo`, so nothing leaks into the app.
- Fonts: the app already loads Inter, Instrument Serif and JetBrains Mono with
  `next/font` (`app/layout.tsx`); point the demo's `font-family` at the app's font
  variables.
- JS: run the state machine in a `useEffect` on the root element. The cleanup
  clears every timeout, interval and listener (the website never unmounts, the
  app does: Back, finish, route change).
- No network calls, no storage, no analytics.
- Reduced motion behaves as on the website.

Changes from the website:
- No start gate (rule 2).
- No "Create free account" anywhere (tab bar and end bar).
- End bar: "Both bugs reported." with **Open the Guide** (primary) and **Play again**.
  "Play again" restarts on the bug 1 intro (still no gate). `TryItDemo` takes an
  `onOpenGuide` prop; `Onboarding` passes a callback that runs the finish path below.
- **Open the Guide** runs the same finish path with `/guide` as the destination
  (save `onboardedAt`, then go to `/guide`). Without the save, the dashboard would
  later bounce the user back to `/welcome`
  (`app/(main)/dashboard/page.tsx` redirects non-onboarded users with no tickets).

## Out of scope

- Steps 1 and 2.
- The marketing site.
- Defaulting the ticket's tracker tab to the user's connected tracker.

## Testing

- `Onboarding.test.tsx`:
  - the rail has four steps;
  - from the extension step, "Continue" opens "Try it";
  - "Continue" is accent once the extension is connected;
  - "All set, take me home" on step 4 saves `onboardedAt` and goes to `/dashboard`;
  - "Open the Guide" saves `onboardedAt` and goes to `/guide`;
  - "Skip setup" hides only on step 4.
- `TryItDemo` test (jsdom, fake timers): mounts straight on the bug 1 intro
  (no start click); after unmount no timer is pending.
- Browser check on `/welcome` (dev server, signed-in dev user or a dev-only
  preview route that is not committed): both bugs end to end at 1280 px and
  375 px, no console errors, the sheet widens only on step 4, Back from step 4
  returns to step 3 and the demo stops.
- `tsc --noEmit`, vitest and eslint pass.

## Where

Built on `claude/interesting-goodall-ec5c39`, on top of the install-first linking
fix (it already changes `Onboarding.tsx`). Commit this spec with the work. Do not
push without asking.
