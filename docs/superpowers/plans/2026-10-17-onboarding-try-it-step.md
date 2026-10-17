# Onboarding step 4 "Try it" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth onboarding step, "Try it", that runs the get-brief.app two-bug demo inside `/welcome` and ends on a link to the Guide.

**Architecture:** The website demo is ported as is: its markup becomes static JSX in `TryItDemo.tsx`, its CSS becomes `try-it-demo.css` scoped under `.try-demo`, and its `initDemo` state machine becomes a typed module that the component runs in a `useEffect` and tears down on unmount. `Onboarding.tsx` gains the step (rail, footers, width) and loads the demo with `next/dynamic` only on that step.

**Tech Stack:** Next 16 (app router, client components), React 19, Tailwind v4 (layered), vitest + jsdom + @testing-library/react.

Spec: `docs/superpowers/specs/2026-10-17-onboarding-try-it-step-design.md`.
Source (read only): `C:\Users\razif\src_perso\brief-marketing-website\index.html` at `4e55799` (`git show 4e55799:index.html`).

---

## File structure

| File | Responsibility |
|---|---|
| `web/components/onboarding/TryItDemo.tsx` (create) | The demo's markup (static JSX, one SVG sprite) and the effect that runs the state machine. Props: `onOpenGuide`. |
| `web/components/onboarding/try-it-demo-machine.ts` (create) | `initDemo(stage, { onOpenGuide })`: the website's state machine, typed, returning a cleanup that clears every timer and listener. |
| `web/components/onboarding/try-it-demo.css` (create) | The demo CSS, every rule under `.try-demo`, tokens redefined on `.try-demo`, fonts from the app's `next/font` variables. |
| `web/components/onboarding/TryItDemo.test.tsx` (create) | Mounts on the bug 1 intro, no start gate, no sign-up link, end bar wiring, nothing pending after unmount. |
| `web/components/Onboarding.tsx` (modify) | Step `tryit`: rail, titles, step 3 Continue, step 4 footer, skip link, 880px sheet, finish destination. |
| `web/components/Onboarding.test.tsx` (modify) | The spec's six onboarding cases. |

Port rules that apply to every file (all come from the app being a different page than the website):

1. **Ids are document-global.** Every SVG symbol and gradient id gets a `td-` prefix (`#mark` -> `#td-mark`, `#i-x` -> `#td-i-x`, `mk-tile` -> `td-mk-tile`), in the markup and in the machine's strings.
2. **The stylesheet is unlayered, Tailwind is layered**, so every declaration in `try-it-demo.css` beats preflight, utilities and the app's `.btn`. What it must add back, because the website relied on browser defaults that preflight removes: `ol` numbering (`list-style:decimal` on `.tk-main ol`), inline `svg`/`img`/`canvas` (`display:revert`), the website's `button` and `*` resets. Tailwind's `ring` utility matches the demo's `.ring` class: give `.try-demo .ring` `box-shadow:none` outside its animation.
3. **The app unmounts, the website never does.** Every `addEventListener` takes one `AbortController` signal; every timeout goes through `later`/`every` (including `settled()`'s fallback and the resize debounce); the cleanup aborts, clears and marks the machine dead so pending promise callbacks do nothing.
4. **Dropped with the start gate:** `.gate` markup and CSS, `act.start`, `start()`'s gate handling, the "any click starts it" branch, `[data-try]` links, `.fx-stage`, `zoom:var(--dz)`.
5. **Dropped with "Create free account":** `.win-cta` (tab bar) and `.tk-store` (end bar). The end bar gets `Open the Guide` (`btn btn-acc btn-sm tk-guide`, `data-act="guide"`) next to `Play again`, shown only when both bugs are in; its text is `<b>Both bugs reported.</b>`.
6. **Symbols kept:** `mark`, `lg-linear`, `lg-jira`, `lg-github`, `lg-acme`, `i-chev`, `i-arrow`, `i-reset`, `i-mic`, `i-x`, `i-video`, `i-shot`, `i-replay`, `i-reload`, `i-puzzle`, `i-plus`, `i-lock`, `i-fwd`, `i-cloud`, `i-check`, `i-back`, `i-alert`, and `i-play` (the tiles and evidence use it; the spec's list missed it). `i-pointer` went with the gate.

---

### Task 1: The demo, mounted with no gate and torn down cleanly

**Files:**
- Create: `web/components/onboarding/TryItDemo.test.tsx`
- Create: `web/components/onboarding/TryItDemo.tsx`, `web/components/onboarding/try-it-demo-machine.ts`, `web/components/onboarding/try-it-demo.css`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import TryItDemo from "./TryItDemo";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const q = (c: HTMLElement, s: string) => c.querySelector<HTMLElement>(s);

describe("TryItDemo", () => {
  it("opens straight on the bug 1 intro: no start screen", () => {
    const { container } = render(<TryItDemo onOpenGuide={() => {}} />);
    expect(q(container, ".gate")).toBeNull();
    const scene = q(container, ".scene")!;
    expect(scene.classList.contains("run")).toBe(true);
    expect(scene.textContent).toContain("Bug 1 of 2");
  });

  it("never offers to create an account", () => {
    const { container } = render(<TryItDemo onOpenGuide={() => {}} />);
    expect(container.textContent).not.toMatch(/Create free account|Sign up free/);
    expect(container.querySelector('a[href*="sign-up"]')).toBeNull();
  });

  it("ends on Open the Guide and Play again", () => {
    const onOpenGuide = vi.fn();
    const { container } = render(<TryItDemo onOpenGuide={onOpenGuide} />);
    const guide = q(container, '[data-act="guide"]')!;
    expect(guide.textContent).toBe("Open the Guide");
    expect(q(container, '[data-act="again"]')!.textContent).toBe("Play again");
    act(() => guide.click());
    expect(onOpenGuide).toHaveBeenCalledTimes(1);
  });

  it("leaves no timer running once unmounted", () => {
    const { container, unmount } = render(<TryItDemo onOpenGuide={() => {}} />);
    act(() => q(container, '[data-act="pay"]')!.click()); // a 900 ms timer
    act(() => q(container, '[data-act="brief"]')!.click()); // the popup and a hint
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run components/onboarding/TryItDemo.test.tsx`
Expected: FAIL, `Failed to resolve import "./TryItDemo"`.

- [ ] **Step 3: Port the demo**

- `try-it-demo-machine.ts`: port `initDemo` (source lines 1508 to 2200) into `export function initDemo(demo: HTMLElement, opts: { onOpenGuide: () => void }): () => void`, typed (`HTMLElement`/`HTMLButtonElement`/`HTMLCanvasElement` queries with `!`), applying port rules 1, 3, 4 and 5. `reduce` reads `window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false`. On init: `reset()` then the old `start()` body without the gate (`started = true; intro(goal, 300); render();`). `act.guide = () => opts.onOpenGuide()`. In `showTicket`, replace the `.tk-store` toggling with `guideBtn.hidden = !!st.next`. `endText()` done branch: `'<b>Both bugs reported.</b>'`. Return `() => { dead = true; clearAll(); clearTimeout(rz); ac.abort(); }`, with `settled().then` and `coachUpdate` callbacks returning early when `dead`.
- `TryItDemo.tsx`: `"use client"`, imports `./try-it-demo.css`, renders `<div className="try-demo">` holding the sprite `<svg width="0" height="0" style={{position:"absolute"}} aria-hidden>` (defs `td-mk-tile`, `td-mk-sheen` from source lines 838 to 846, symbols from rule 6) and the `.stage` markup from source lines 967 to 1156 converted to JSX (no `.win-cta`, no `.gate`, no `fx-stage`, the end bar per rule 5, the `<pre>` lines as string literals so whitespace survives). `useEffect(() => initDemo(stageRef.current!, { onOpenGuide: () => guideRef.current() }), [])`, with `guideRef` kept current so a new callback never restarts the demo. Wrapped in `memo`.
- `try-it-demo.css`: source lines 208 to 564 (minus the gate block and `.win-cta`), every selector prefixed with `.try-demo `, plus port rule 2 and:

```css
.try-demo{
  --cream:#f5f1e8; --cream-2:#ece6d6;
  --ink:#1a1612; --ink-2:#3a3530; --muted:#8a8378;
  --acc:#dd6936; --acc-2:#c95c2c; --acc-soft:rgba(221,105,54,.10);
  --hair:rgba(26,22,18,.10); --hair-2:rgba(26,22,18,.06);
  --surface:#fffdfa; --green:#2f9e5f; --red:#e5484d;
  --serif:var(--font-display),Georgia,serif;
  --sans:var(--font-inter),ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
  --mono:var(--font-mono),ui-monospace,SFMono-Regular,monospace;
  --ease:cubic-bezier(.22,1,.36,1);
  font-family:var(--sans);font-size:16px;line-height:1.6;color:var(--ink);
  -webkit-font-smoothing:antialiased;font-feature-settings:"cv11","ss01";
}
.try-demo *{box-sizing:border-box;margin:0;padding:0}
.try-demo a{color:inherit;text-decoration:none}
.try-demo button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
.try-demo :where(svg,img,canvas){display:revert;vertical-align:revert}
.try-demo svg{flex:none}
.try-demo :focus-visible{outline:2px solid var(--acc);outline-offset:3px;border-radius:8px}
.try-demo [hidden]{display:none!important}
```

  plus the website's `.btn`, `.btn-acc`, `.btn-ghost`, `.btn-sm`, `.btn .arr` rules (source lines 120 to 141), `@keyframes up` and `shine`, and its reduced-motion block scoped to `.try-demo *`.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web && npx vitest run components/onboarding/TryItDemo.test.tsx`
Expected: 4 passed.

### Task 2: Onboarding step 4

**Files:**
- Modify: `web/components/Onboarding.test.tsx`
- Modify: `web/components/Onboarding.tsx`

- [ ] **Step 1: Write the failing tests** (in `Onboarding.test.tsx`; the router mock becomes a shared `replace` spy, the demo is mocked so the test drives `onOpenGuide` directly)

```tsx
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./onboarding/TryItDemo", () => ({
  default: ({ onOpenGuide }: { onOpenGuide: () => void }) => (
    <button type="button" onClick={onOpenGuide}>Open the Guide</button>
  ),
}));

describe("Onboarding's Try it step", () => {
  beforeEach(() => {
    localStorage.clear();
    router.replace.mockClear();
    connections = Promise.resolve({ owned: [{ provider: "asana", label: null, workspace: null }], configured: {} });
  });
  const settingsPosts = () =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter(([url]) => url === "/api/settings")
      .map(([, init]) => JSON.parse((init as RequestInit).body as string));
  const toTryIt = async () => {
    renderWizard();
    await screen.findByText("Install the extension");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Try it" });
  };

  it("has four steps on the rail", async () => {
    renderWizard();
    await screen.findByText("Install the extension");
    expect(screen.getAllByRole("listitem").map((li) => li.textContent?.replace(/^\d/, ""))).toEqual(
      expect.arrayContaining(["You", "Tracker", "Extension", "Try it"]),
    );
  });

  it("goes from the extension step to Try it with Continue", async () => {
    await toTryIt();
    expect(screen.getByText("Report two bugs. About a minute.")).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("makes Continue the accent button once the extension is connected", async () => {
    renderWizard();
    await screen.findByText("Install the extension");
    expect(screen.getByRole("button", { name: "Continue" }).className).not.toMatch(/btn-accent/);
    localStorage.setItem("briefExtSyncedUser", "user_1");
    await act(async () => window.dispatchEvent(new Event("brief-ext-paired")));
    expect(screen.getByRole("button", { name: "Continue" }).className).toMatch(/btn-accent/);
  });

  it("finishes from Try it: All set saves onboardedAt and goes to the dashboard", async () => {
    await toTryIt();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "All set, take me home" })));
    expect(settingsPosts()).toContainEqual({ onboardedAt: true });
    expect(router.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("finishes from Try it: Open the Guide saves onboardedAt and goes to the Guide", async () => {
    await toTryIt();
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Open the Guide" })));
    expect(settingsPosts()).toContainEqual({ onboardedAt: true });
    expect(router.replace).toHaveBeenCalledWith("/guide");
  });

  it("hides Skip setup only on Try it", async () => {
    renderWizard();
    await screen.findByText("Install the extension");
    expect(screen.getByRole("button", { name: "Skip setup, straight home" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Try it" });
    expect(screen.queryByRole("button", { name: "Skip setup, straight home" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx vitest run components/Onboarding.test.tsx`
Expected: the six new cases FAIL (no "Continue" on the extension step, no Try it), the earlier cases pass.

- [ ] **Step 3: Implement in `Onboarding.tsx`**

```tsx
const TryItDemo = dynamic(() => import("./onboarding/TryItDemo"), { ssr: false });

type Step = "you" | "tracker" | "extension" | "tryit";
const STEP_ORDER: Step[] = ["you", "tracker", "extension", "tryit"];
// StepRail labels: tryit: "Try it"
// stepTitle.tryit = "Try it"; stepSub.tryit = "Report two bugs. About a minute."

async function finish(to: "/dashboard" | "/guide" = "/dashboard") {
  if (finishing) return;
  setFinishing(true);
  await saveSettings({ onboardedAt: true });
  router.replace(to);
}

// outer wrapper: className={`w-full ${step === "tryit" ? "max-w-[880px]" : "max-w-[560px]"}`}
// body: {step === "tryit" && <div className="mt-5"><TryItDemo onOpenGuide={() => finish("/guide")} /></div>}
// extension footer right: <button onClick={() => setStep("tryit")} className={`${extensionPaired ? "btn-accent" : "btn"} cursor-pointer`}>Continue</button>
// tryit footer: Back -> setStep("extension"); "All set, take me home" -> finish()
// skip link: {step !== "tryit" && (...)}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cd web && npx vitest run components/Onboarding.test.tsx components/onboarding`
Expected: all pass.

### Task 3: Checks and the browser run

- [ ] **Step 1:** `cd web && npx tsc --noEmit` (exit 0), `npx vitest run` (all pass), `npx eslint components/Onboarding.tsx components/Onboarding.test.tsx components/onboarding` (clean).
- [ ] **Step 2:** Temporary dev-only route `web/app/dev/try-it/page.tsx` (`notFound()` unless `NODE_ENV === "development"`) rendering `<OnboardingClient initialRole="" initialSource="" greetingName="Razi" />`, plus `"/dev/(.*)"` in `proxy.ts` `isPublic`. Signed out, `useTrackerConnect` reports loaded (`ownedLoaded || !user`), so the real wizard runs.
- [ ] **Step 3:** In a browser at 1280 px and at 375 px: walk to Try it, report bug 1 (Brief, Add, Screenshot, circle the CVC field, Save, Create ticket) and bug 2 (Pay, Brief, Add, Replay, Create ticket), see "Both bugs reported." with Open the Guide and Play again, Play again restarts on the bug 1 intro, no console errors, the sheet is 880 px only on Try it, Back returns to the extension step and the demo's timers stop.
- [ ] **Step 4:** Delete the route and the `proxy.ts` line; `git status` shows neither.
- [ ] **Step 5: Commit** the spec, this plan and the work on `claude/interesting-goodall-ec5c39` (no push).

```bash
git add docs/superpowers/specs/2026-10-17-onboarding-try-it-step-design.md docs/superpowers/plans/2026-10-17-onboarding-try-it-step.md web/components/Onboarding.tsx web/components/Onboarding.test.tsx web/components/onboarding
git commit -m "Onboarding: a Try it step with the two-bug demo, then the Guide"
```

---

## Found in the browser run (2026-10-17), added

- **The rail on phones.** Four labels don't fit 375 px ("Try it" wrapped onto two lines). Below `sm`, only the current step's label shows; the others stay for screen readers (`max-sm:sr-only`).
- **The fold.** At 1280 x 800 the demo started at y 347, so its lower half and the footer were off screen. On Try it the footer is scrolled into view (`block: "nearest"`, smooth unless reduced motion): the title, the whole demo and the footer then fit at 1280 x 800 and 375 x 812. The lazy demo's loading stand-in has the demo window's height (600 px, 610 px from 1100 px), so the scroll lands where the demo will be.
- Harness note: `el.scrollIntoView()` on an element inside the demo also scrolls its `overflow:hidden` panes and shifts the drawing layer; scroll the page with `window.scrollBy` instead.

Result: both bugs end to end with real mouse input, 22/22 at 1280 x 800 and 22/22 at 375 x 812 (no console errors, the demo's timers drop to 0 after Back, Open the Guide posts `onboardedAt` and heads to /guide).
