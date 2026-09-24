# Podium hats, tracker picker, team list: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the podium funny hats, fold the three tracker cards into one card with a dropdown, and list the org's members on the Connections page (renamed Settings).

**Architecture:** Pure logic in `web/lib` (`googly.ts`, `team.ts`) with node tests; presentational client components (`PodiumHats`, `TrackerPicker`) that take plain props and are tested in jsdom; one new server read (`getOrgTeam`) built from the same roster and aggregate as the podium. Spec: `docs/superpowers/specs/2026-09-24-podium-hats-tracker-picker-team-design.md`.

**Tech Stack:** Next 16 (App Router), React 19, Tailwind v4, Clerk, Supabase, Vitest 4 + Testing Library (jsdom via a `// @vitest-environment jsdom` docblock).

All commands run from `web/`. Baseline before starting: 33 files, 353 tests green, `npx tsc --noEmit` clean.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `web/lib/googly.ts` | new | `pupilOffset`: where a pupil sits for a pointer position |
| `web/lib/team.ts` | new | `TeamMember` type, `sortTeam` (you first, then A to Z) |
| `web/components/Avatar.tsx` | new | picture or initials; shared by the podium and the team list |
| `web/components/PodiumHats.tsx` | new | `GooglyCrown`, `PartyHat`, `PaperCrown`, `Hatted` |
| `web/components/Podium.tsx` | modify | hats instead of `♔`, shared `Avatar` |
| `web/app/globals.css` | modify | `hat-bob` keyframe, `.googly-eye`, reduced motion |
| `web/components/TrackerPicker.tsx` | new | one tracker card with a listbox dropdown (props only) |
| `web/components/Integrations.tsx` | modify | container: Clerk state into `TrackerPicker` |
| `web/lib/org-server.ts` | modify | `padToRoster`, `fullName` in `lookupNames`, `getOrgTeam` |
| `web/components/TeamList.tsx` | new | the roster section |
| `web/app/(main)/connections/page.tsx` | modify | fetch and render the team, title Settings |
| `web/components/Nav.tsx` | modify | label Settings |
| `web/lib/trackers/registry.ts`, `web/lib/linear.ts`, `web/lib/github.ts`, `web/lib/agent/run-processing.ts` | modify | "Connections" becomes "Settings" in user-facing errors |

---

### Task 1: Googly-eye maths

**Files:**
- Create: `web/lib/googly.ts`
- Test: `web/lib/googly.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { FULL_LEAN_PX, pupilOffset } from "./googly";

describe("pupilOffset", () => {
  it("looks straight ahead when the pointer is on the eye", () => {
    expect(pupilOffset({ x: 10, y: 10 }, { x: 10, y: 10 }, 2)).toEqual({ dx: 0, dy: 0 });
  });

  it("leans all the way toward a far pointer, and no further", () => {
    const { dx, dy } = pupilOffset({ x: 0, y: 0 }, { x: 500, y: 0 }, 2);
    expect(dx).toBeCloseTo(2);
    expect(dy).toBeCloseTo(0);
  });

  it("looks the way the pointer is", () => {
    const { dx, dy } = pupilOffset({ x: 0, y: 0 }, { x: -300, y: -300 }, 2);
    expect(dx).toBeLessThan(0);
    expect(dy).toBeLessThan(0);
    expect(Math.hypot(dx, dy)).toBeCloseTo(2);
  });

  it("leans only part of the way toward a nearby pointer", () => {
    const { dx } = pupilOffset({ x: 0, y: 0 }, { x: FULL_LEAN_PX / 2, y: 0 }, 2);
    expect(dx).toBeCloseTo(1);
  });

  it("stays put when it has no room to move", () => {
    expect(pupilOffset({ x: 0, y: 0 }, { x: 100, y: 0 }, 0)).toEqual({ dx: 0, dy: 0 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run lib/googly.test.ts`
Expected: FAIL, `Failed to resolve import "./googly"`.

- [ ] **Step 3: Implement**

```ts
/**
 * Googly-eye maths for the podium crown (components/PodiumHats.tsx).
 *
 * Pure so it can be tested without a DOM: the component measures where the eye
 * and the pointer are, this decides where the pupil sits. The pupil leans toward
 * the pointer, further the further away the pointer is, and never leaves the
 * eye: `max` is the most it may travel from the centre.
 */

export type Point = { x: number; y: number };

/** How far away (px) the pointer has to be before the pupil leans all the way. */
export const FULL_LEAN_PX = 40;

/**
 * The pupil's offset from the centre of its eye.
 *
 * `eye` and `pointer` are screen coordinates in px. The result is in whatever
 * unit `max` is in: the crown passes SVG user units, so the offset goes straight
 * into a `transform` on the pupil.
 */
export function pupilOffset(eye: Point, pointer: Point, max: number): { dx: number; dy: number } {
  const vx = pointer.x - eye.x;
  const vy = pointer.y - eye.y;
  const dist = Math.hypot(vx, vy);
  if (dist === 0 || max <= 0) return { dx: 0, dy: 0 };
  const reach = Math.min(max, (dist / FULL_LEAN_PX) * max);
  return { dx: (vx / dist) * reach, dy: (vy / dist) * reach };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run lib/googly.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/googly.ts lib/googly.test.ts
git commit -m "feat(web): the maths behind a pair of googly eyes"
```

---

### Task 2: Shared avatar

**Files:**
- Create: `web/components/Avatar.tsx`
- Modify: `web/components/Podium.tsx` (delete its local `Avatar`, import the shared one)

- [ ] **Step 1: Create the component**

```tsx
/**
 * A person's picture, or their initials on the accent tint when there isn't one.
 * Shared by the podium and the Settings team list.
 */

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  // "Razi Fezzani" -> RF; a lone first name keeps its first two letters.
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}

export default function Avatar({
  name,
  imageUrl,
  size,
}: {
  name: string;
  imageUrl?: string;
  size: number;
}) {
  return imageUrl ? (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={imageUrl}
      alt=""
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full object-cover"
    />
  ) : (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-[rgba(221,105,54,.12)] text-[0.6875rem] text-accent"
    >
      {initialsOf(name)}
    </span>
  );
}
```

- [ ] **Step 2: Use it in Podium.tsx**

Delete the local `function Avatar({ entry, size }: ...)` (lines 29 to 47), add `import Avatar from "./Avatar";`, and change the three call sites:

```tsx
<Avatar name={entry.name} imageUrl={entry.imageUrl} size={50} />            // SoloCard
<Avatar name={entry.name} imageUrl={entry.imageUrl} size={i === 1 ? 50 : 40} /> // podium step
<Avatar name={entry.name} imageUrl={entry.imageUrl} size={24} />            // rest list
```

- [ ] **Step 3: Run the podium tests**

Run: `npx vitest run components/Podium.test.tsx`
Expected: PASS, unchanged (a pure extraction).

- [ ] **Step 4: Commit**

```bash
git add components/Avatar.tsx components/Podium.tsx
git commit -m "refactor(web): one Avatar for the podium and the team list"
```

---

### Task 3: The hats

**Files:**
- Create: `web/components/PodiumHats.tsx`
- Modify: `web/app/globals.css` (before `@media (prefers-reduced-motion: reduce)`, and inside it)
- Test: `web/components/PodiumHats.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { GooglyCrown, Hatted } from "./PodiumHats";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("GooglyCrown", () => {
  it("looks toward the pointer", async () => {
    const { container } = render(<GooglyCrown />);
    // jsdom lays nothing out, so both eyes sit at (0, 0): a pointer far to the
    // right should push both pupils all the way right.
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 500, clientY: 0 }));
    await waitFor(() => {
      const pupils = container.querySelectorAll(".googly-pupil");
      expect(pupils).toHaveLength(2);
      pupils.forEach((p) => expect(p.getAttribute("transform")).toBe("translate(2.40 0.00)"));
    });
  });

  it("holds still for people who asked for less motion", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const { container } = render(<GooglyCrown />);
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 500, clientY: 0 }));
    await new Promise((r) => setTimeout(r, 50));
    container
      .querySelectorAll(".googly-pupil")
      .forEach((p) => expect(p.getAttribute("transform")).toBeNull());
  });

  it("blinks now and then", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0); // the shortest gap: 2.5s
    const { container } = render(<GooglyCrown />);
    const eye = () => container.querySelector(".googly-eye")!;
    expect(eye().getAttribute("data-blink")).toBe("false");
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(eye().getAttribute("data-blink")).toBe("true");
    act(() => {
      vi.advanceTimersByTime(140);
    });
    expect(eye().getAttribute("data-blink")).toBe("false");
  });
});

describe("Hatted", () => {
  it.each([
    [1, "crown"],
    [2, "party"],
    [3, "paper"],
  ])("gives place %i the %s", (rank, hat) => {
    const { container } = render(
      <Hatted rank={rank}>
        <span>face</span>
      </Hatted>,
    );
    expect(container.querySelector(`[data-hat="${hat}"]`)).toBeTruthy();
  });

  it("leaves everyone past third bareheaded", () => {
    const { container } = render(
      <Hatted rank={4}>
        <span>face</span>
      </Hatted>,
    );
    expect(container.querySelector("[data-hat]")).toBeNull();
    expect(container.textContent).toBe("face");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run components/PodiumHats.test.tsx`
Expected: FAIL, `Failed to resolve import "./PodiumHats"`.

- [ ] **Step 3: Implement the component**

```tsx
"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { pupilOffset } from "@/lib/googly";

/**
 * Headwear for the podium: a googly-eyed crown for first place, a party hat for
 * second, a paper crown for third. Everyone past third gets a plain list row.
 *
 * Purely decorative: every hat is aria-hidden and nothing depends on it. Motion
 * respects prefers-reduced-motion - the hats stop bobbing (globals.css) and the
 * crown stops blinking and looking around (below).
 */

/** Pupil radius, and how far it may travel from the centre of its eye (SVG units). */
const PUPIL_R = 2.4;
const PUPIL_TRAVEL = 2.4;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function GooglyCrown() {
  const whites = useRef<Array<SVGCircleElement | null>>([]);
  const pupils = useRef<Array<SVGCircleElement | null>>([]);
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    // One read per animation frame, however fast the pointer moves.
    let frame = 0;
    let pointer: { x: number; y: number } | null = null;
    const look = () => {
      frame = 0;
      const p = pointer;
      if (!p) return;
      whites.current.forEach((white, i) => {
        const pupil = pupils.current[i];
        if (!white || !pupil) return;
        const r = white.getBoundingClientRect();
        const { dx, dy } = pupilOffset(
          { x: r.left + r.width / 2, y: r.top + r.height / 2 },
          p,
          PUPIL_TRAVEL,
        );
        pupil.setAttribute("transform", `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
      });
    };
    const onMove = (e: MouseEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(look);
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    // Irregular on purpose: a blink on a metronome reads as a screensaver.
    let shut: ReturnType<typeof setTimeout> | undefined;
    let open: ReturnType<typeof setTimeout> | undefined;
    const scheduleBlink = () => {
      shut = setTimeout(() => {
        setBlink(true);
        open = setTimeout(() => {
          setBlink(false);
          scheduleBlink();
        }, 140);
      }, 2500 + Math.random() * 3500);
    };
    scheduleBlink();

    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(shut);
      clearTimeout(open);
    };
  }, []);

  return (
    <svg
      data-hat="crown"
      width={48}
      height={32}
      viewBox="-3 0 46 31"
      className="block origin-bottom -rotate-6"
      aria-hidden
    >
      <path
        d="M4 29 L2 8 L12 15 L20 3 L28 15 L38 8 L36 29 Z"
        fill="#EF9F27"
        stroke="#854F0B"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <circle cx={2} cy={8} r={2.8} fill="#dd6936" />
      <circle cx={20} cy={3} r={2.8} fill="#dd6936" />
      <circle cx={38} cy={8} r={2.8} fill="#dd6936" />
      {[13.5, 26.5].map((cx, i) => (
        <g key={cx} className="googly-eye" data-blink={blink}>
          <circle
            ref={(el) => {
              whites.current[i] = el;
            }}
            cx={cx}
            cy={21}
            r={5}
            fill="#fffdf8"
            stroke="#854F0B"
            strokeWidth={1}
          />
          <circle
            ref={(el) => {
              pupils.current[i] = el;
            }}
            className="googly-pupil"
            cx={cx}
            cy={21}
            r={PUPIL_R}
            fill="#1a1612"
          />
        </g>
      ))}
    </svg>
  );
}

export function PartyHat() {
  return (
    <svg
      data-hat="party"
      width={22}
      height={25}
      viewBox="0 0 26 30"
      className="hat-bob block"
      style={{ "--hat-tilt": "-10deg", animationDelay: "-0.4s" } as CSSProperties}
      aria-hidden
    >
      <path
        d="M3 29 L13 4 L23 29 Z"
        fill="#AFA9EC"
        stroke="#534AB7"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <path d="M6.5 21 L19.5 21" stroke="#fffdf8" strokeWidth={2} />
      <path d="M9.5 13.5 L16.5 13.5" stroke="#fffdf8" strokeWidth={2} />
      <circle cx={13} cy={4} r={3.2} fill="#dd6936" />
    </svg>
  );
}

export function PaperCrown() {
  return (
    <svg
      data-hat="paper"
      width={30}
      height={16}
      viewBox="0 0 34 18"
      className="hat-bob block"
      style={{ "--hat-tilt": "8deg", animationDelay: "-1.1s" } as CSSProperties}
      aria-hidden
    >
      <path
        d="M1 17 L1 5 L7 11 L12 3 L17 11 L22 3 L27 11 L33 5 L33 17 Z"
        fill="#fffdf8"
        stroke="#8a8378"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

type PodiumRank = 1 | 2 | 3;

function isPodiumRank(rank: number): rank is PodiumRank {
  return rank === 1 || rank === 2 || rank === 3;
}

/** Each hat's height (px), and how far it sits down over the head. */
const FIT: Record<PodiumRank, { height: number; overlap: number }> = {
  1: { height: 32, overlap: 12 },
  2: { height: 25, overlap: 8 },
  3: { height: 16, overlap: 6 },
};

/**
 * An avatar wearing the hat its podium place earns, or just the avatar.
 *
 * The wrapper reserves the room the hat rises above the head, so a hat never
 * climbs into the leader's speech bubble.
 */
export function Hatted({ rank, children }: { rank: number; children: ReactNode }) {
  if (!isPodiumRank(rank)) return <>{children}</>;
  const { height, overlap } = FIT[rank];
  return (
    <span className="relative inline-flex" style={{ marginTop: height - overlap }}>
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 -translate-x-1/2"
        style={{ bottom: `calc(100% - ${overlap}px)` }}
      >
        {rank === 1 ? <GooglyCrown /> : rank === 2 ? <PartyHat /> : <PaperCrown />}
      </span>
    </span>
  );
}
```

- [ ] **Step 4: Add the CSS** (in `globals.css`, immediately before `@media (prefers-reduced-motion: reduce) {`)

```css
/* Podium hats (components/PodiumHats.tsx): 2nd and 3rd place bob, each at its
   own tilt; the crown holds still and watches the pointer instead. */
@keyframes hat-bob {
  0%,
  100% {
    transform: translateY(0) rotate(var(--hat-tilt, 0deg));
  }
  50% {
    transform: translateY(-3px) rotate(calc(var(--hat-tilt, 0deg) + 6deg));
  }
}
.hat-bob {
  transform: rotate(var(--hat-tilt, 0deg));
  transform-origin: 50% 100%;
  animation: hat-bob 2.4s ease-in-out infinite;
}
.googly-eye {
  transform-box: fill-box;
  transform-origin: center;
  transition: transform 80ms ease-out;
}
.googly-eye[data-blink="true"] {
  transform: scaleY(0.12);
}
```

and inside the existing reduced-motion block:

```css
  .hat-bob {
    animation: none;
  }
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run components/PodiumHats.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add components/PodiumHats.tsx components/PodiumHats.test.tsx app/globals.css
git commit -m "feat(web): a googly-eyed crown, a party hat and a paper crown"
```

---

### Task 4: Put the hats on the podium

**Files:**
- Modify: `web/components/Podium.tsx`
- Test: `web/components/Podium.test.tsx`

- [ ] **Step 1: Write the failing tests** (append to `Podium.test.tsx`)

```tsx
describe("Podium hats", () => {
  it("crowns first place, gives second a party hat and third a paper crown", () => {
    render(<Podium month={entries} all={entries} orgName="Acme" />);
    // The steps stand 2nd, 1st, 3rd.
    const steps = screen.getAllByRole("listitem").slice(0, 3);
    expect(steps[1].querySelector('[data-hat="crown"]')).toBeTruthy();
    expect(steps[0].querySelector('[data-hat="party"]')).toBeTruthy();
    expect(steps[2].querySelector('[data-hat="paper"]')).toBeTruthy();
  });

  it("keeps hats off everyone past third place", () => {
    const { container } = render(<Podium month={entries} all={entries} orgName="Acme" />);
    expect(container.querySelectorAll("[data-hat]")).toHaveLength(3);
  });

  it("hands out two hats on a podium of two", () => {
    const pair = entries.slice(0, 2);
    const { container } = render(<Podium month={pair} all={pair} orgName="Acme" />);
    expect(container.querySelector('[data-hat="crown"]')).toBeTruthy();
    expect(container.querySelector('[data-hat="party"]')).toBeTruthy();
    expect(container.querySelector('[data-hat="paper"]')).toBeNull();
  });

  it("crowns a lone reporter", () => {
    const { container } = render(
      <Podium month={[entries[0]]} all={[entries[0]]} orgName="Acme" />,
    );
    expect(container.querySelectorAll("[data-hat]")).toHaveLength(1);
    expect(container.querySelector('[data-hat="crown"]')).toBeTruthy();
  });

  it("no longer draws the old crown glyph", () => {
    const { container } = render(<Podium month={entries} all={entries} orgName="Acme" />);
    expect(container.textContent).not.toContain("♔");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run components/Podium.test.tsx`
Expected: FAIL on the five new tests (no `[data-hat]`, and `♔` still present).

- [ ] **Step 3: Implement** (`Podium.tsx`)

Add `import { Hatted } from "./PodiumHats";`. In `SoloCard`, replace

```tsx
        <span aria-hidden className="mt-1 text-base leading-none text-accent">
          ♔
        </span>
        <div className="mt-1 flex justify-center">
          <Avatar name={entry.name} imageUrl={entry.imageUrl} size={50} />
        </div>
```

with

```tsx
        <div className="mt-1 flex justify-center">
          <Hatted rank={1}>
            <Avatar name={entry.name} imageUrl={entry.imageUrl} size={50} />
          </Hatted>
        </div>
```

In the podium step, replace

```tsx
              {i === 1 && (
                <span aria-hidden className="block text-base leading-none text-accent">
                  ♔
                </span>
              )}
              <div className="mt-1 flex justify-center">
                <Avatar name={entry.name} imageUrl={entry.imageUrl} size={i === 1 ? 50 : 40} />
              </div>
```

with

```tsx
              <div className="mt-1 flex justify-center">
                <Hatted rank={entry.rank}>
                  <Avatar name={entry.name} imageUrl={entry.imageUrl} size={i === 1 ? 50 : 40} />
                </Hatted>
              </div>
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run components/Podium.test.tsx`
Expected: PASS, all old and new tests.

- [ ] **Step 5: Commit**

```bash
git add components/Podium.tsx components/Podium.test.tsx
git commit -m "feat(web): the podium wears its hats"
```

---

### Task 5: TrackerPicker

**Files:**
- Create: `web/components/TrackerPicker.tsx`
- Test: `web/components/TrackerPicker.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import TrackerPicker, { type TrackerOption } from "./TrackerPicker";

afterEach(cleanup);

const OPTIONS: TrackerOption[] = [
  { key: "linear", name: "Linear", caption: "Files tickets with embedded evidence." },
  { key: "jira", name: "Jira", caption: "Atlassian Cloud - file to a project." },
  { key: "github", name: "GitHub", caption: "File issues to a repository." },
];

function setup(props: Partial<ComponentProps<typeof TrackerPicker>> = {}) {
  const onConnect = vi.fn();
  const onDisconnect = vi.fn();
  const view = render(
    <TrackerPicker
      options={OPTIONS}
      connected="linear"
      stale={[]}
      busy={{}}
      messageFor={() => null}
      onConnect={onConnect}
      onDisconnect={onDisconnect}
      {...props}
    />,
  );
  return { ...view, onConnect, onDisconnect };
}

const trigger = () => screen.getByRole("button", { expanded: false });

function pick(name: string) {
  fireEvent.click(trigger());
  fireEvent.click(screen.getByRole("option", { name: new RegExp(name) }));
}

describe("TrackerPicker", () => {
  it("shows only the tracker you're connected to", () => {
    setup();
    expect(trigger().textContent).toContain("Linear");
    expect(screen.queryByText("Jira")).toBeNull();
    expect(screen.queryByText("GitHub")).toBeNull();
    expect(screen.getByText("Connected ✓")).toBeTruthy();
  });

  it("lists every tracker when opened, with the current one selected", () => {
    setup();
    fireEvent.click(trigger());
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
  });

  it("previews another tracker without switching to it", () => {
    const { onConnect } = setup();
    pick("Jira");
    expect(onConnect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Switch to Jira →" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("switches only when asked", () => {
    const { onConnect } = setup();
    pick("Jira");
    fireEvent.click(screen.getByRole("button", { name: "Switch to Jira →" }));
    expect(onConnect).toHaveBeenCalledWith("jira");
  });

  it("says which tracker a switch disconnects", () => {
    setup();
    pick("Jira");
    expect(screen.getByRole("button", { name: "Switch to Jira →" }).getAttribute("title")).toBe(
      "Disconnects Linear",
    );
  });

  it("goes back to the connected tracker on cancel", () => {
    setup();
    pick("Jira");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(trigger().textContent).toContain("Linear");
    expect(screen.getByText("Connected ✓")).toBeTruthy();
  });

  it("offers to connect when nothing is connected yet", () => {
    const { onConnect } = setup({ connected: null });
    expect(trigger().textContent).toContain("Choose a tracker");
    pick("GitHub");
    fireEvent.click(screen.getByRole("button", { name: "Connect GitHub →" }));
    expect(onConnect).toHaveBeenCalledWith("github");
  });

  it("asks to reconnect a tracker whose grant went stale", () => {
    const { onConnect } = setup({ stale: ["linear"] });
    expect(screen.getByText("Reconnect needed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect →" }));
    expect(onConnect).toHaveBeenCalledWith("linear");
  });

  it("disconnects", () => {
    const { onDisconnect } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onDisconnect).toHaveBeenCalledWith("linear");
  });

  it("opens on the tracker whose last attempt didn't finish, with its message", () => {
    setup({
      connected: null,
      initialSelected: "jira",
      messageFor: (k) => (k === "jira" ? "Last connection didn’t finish" : null),
    });
    expect(trigger().textContent).toContain("Jira");
    expect(screen.getByText("Last connection didn’t finish")).toBeTruthy();
  });

  it("keeps the card on a tracker you just disconnected", () => {
    const { rerender, onConnect, onDisconnect } = setup();
    rerender(
      <TrackerPicker
        options={OPTIONS}
        connected={null}
        stale={[]}
        busy={{}}
        messageFor={() => null}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
      />,
    );
    expect(screen.getByRole("button", { name: "Connect Linear →" })).toBeTruthy();
  });

  it("works from the keyboard", () => {
    setup();
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Switch to Jira →" })).toBeTruthy();
  });

  it("closes on Escape and hands focus back", () => {
    setup();
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on a click outside", () => {
    setup();
    fireEvent.click(trigger());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("locks the choice while something is in flight", () => {
    setup({ busy: { linear: true } });
    expect(trigger()).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Disconnecting…" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run components/TrackerPicker.test.tsx`
Expected: FAIL, `Failed to resolve import "./TrackerPicker"`.

- [ ] **Step 3: Implement**

```tsx
"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { TrackerLogo } from "./TrackerLogo";
import type { ProviderKey } from "./provider-labels";

/**
 * The issue tracker, as one card with a dropdown.
 *
 * Brief files into exactly one tracker, so a card per provider made the page
 * read like a choice you have to keep making. The card shows the tracker you
 * have; the dropdown is for the rare switch.
 *
 * Picking from the dropdown only PREVIEWS a tracker - the buttons on the card do
 * the work. A switch disconnects the current tracker and redirects to OAuth, so
 * it must never hang off a single mis-click in a menu.
 *
 * Presentational: no Clerk here. Integrations.tsx owns the connection logic and
 * hands this plain state and callbacks, which is what lets tests render it.
 */

export type TrackerOption = { key: ProviderKey; name: string; caption: string };

type Props = {
  options: TrackerOption[];
  /** The tracker Brief files into, if any. */
  connected: ProviderKey | null;
  /** Trackers Clerk calls connected but won't vend a token for any more. */
  stale: string[];
  /** Trackers with a connect or disconnect in flight. */
  busy: Record<string, boolean>;
  /**
   * What the card opens on. Integrations passes the tracker whose last attempt
   * didn't finish, so its error is on screen after the OAuth round trip.
   * Defaults to the connected tracker.
   */
  initialSelected?: ProviderKey | null;
  /** Start with the dropdown open. */
  defaultOpen?: boolean;
  /** An error, pending-verification or fallback line for a tracker, or null. */
  messageFor: (key: ProviderKey) => ReactNode;
  onConnect: (key: ProviderKey) => void;
  onDisconnect: (key: ProviderKey) => void;
};

function Chevron() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function Check() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12l5 5L20 6" />
    </svg>
  );
}

const LINK = "text-xs tracking-wide no-underline hover:underline disabled:opacity-50";

export default function TrackerPicker({
  options,
  connected,
  stale,
  busy,
  initialSelected,
  defaultOpen = false,
  messageFor,
  onConnect,
  onDisconnect,
}: Props) {
  const [selected, setSelected] = useState<ProviderKey | null>(
    initialSelected ?? connected ?? null,
  );
  const [open, setOpen] = useState(defaultOpen);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  // Follow a connection that changes under us: once a tracker is connected it is
  // what the card shows. A disconnect leaves the selection alone, so the card
  // turns into "Connect Linear" rather than going blank.
  const [seenConnected, setSeenConnected] = useState(connected);
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected) setSelected(connected);
  }

  const shown = options.find((o) => o.key === selected) ?? null;
  const anyBusy = Object.values(busy).some(Boolean);

  function openMenu() {
    const i = options.findIndex((o) => o.key === selected);
    setActive(i >= 0 ? i : 0);
    setOpen(true);
  }

  function close(refocus = true) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function choose(key: ProviderKey) {
    setSelected(key);
    close();
  }

  // Focus moves into the list while it is open, so the arrow keys drive it.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function onTriggerKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openMenu();
    }
  }

  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    const last = options.length - 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i >= last ? 0 : i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? last : i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(last);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(options[active].key);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close(false);
    }
  }

  function actions(): ReactNode {
    if (!shown) return null;
    const key = shown.key;
    const isBusy = !!busy[key];

    if (key === connected) {
      if (stale.includes(key)) {
        return (
          <>
            <span className="pill border-[rgba(221,105,54,.35)] bg-[rgba(221,105,54,.1)] text-accent">
              Reconnect needed
            </span>
            <button
              type="button"
              onClick={() => onConnect(key)}
              disabled={isBusy}
              className={`${LINK} text-accent`}
            >
              {isBusy ? "Reconnecting…" : "Reconnect →"}
            </button>
          </>
        );
      }
      return (
        <>
          <span className="pill border-[rgba(46,125,50,.35)] bg-[rgba(46,125,50,.1)] text-[#2e7d32]">
            Connected ✓
          </span>
          <button
            type="button"
            onClick={() => onDisconnect(key)}
            disabled={isBusy}
            className={`${LINK} text-muted hover:text-accent`}
          >
            {isBusy ? "Disconnecting…" : "Disconnect"}
          </button>
        </>
      );
    }

    if (connected) {
      const current = options.find((o) => o.key === connected)?.name ?? "your current tracker";
      return (
        <>
          <button
            type="button"
            onClick={() => setSelected(connected)}
            disabled={isBusy}
            className={`${LINK} text-muted hover:text-ink`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConnect(key)}
            disabled={isBusy}
            title={`Disconnects ${current}`}
            className={`${LINK} text-accent`}
          >
            {isBusy ? "Switching…" : `Switch to ${shown.name} →`}
          </button>
        </>
      );
    }

    return (
      <button
        type="button"
        onClick={() => onConnect(key)}
        disabled={isBusy}
        className={`${LINK} text-accent`}
      >
        {isBusy ? "Connecting…" : `Connect ${shown.name} →`}
      </button>
    );
  }

  const message = shown ? messageFor(shown.key) : null;

  return (
    // relative z-10: .card's backdrop-filter makes every card its own stacking
    // context, which traps the menu's z-index inside this one - without lifting
    // the whole card, the next section's card paints over the open dropdown.
    <div ref={rootRef} className="card relative z-10 px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-[#fffdf8] ${
              shown ? "hairline" : "border-dashed border-[rgba(26,22,18,.25)]"
            }`}
          >
            {shown && <TrackerLogo kind={shown.key} size={20} />}
          </span>

          <div className="relative min-w-0">
            <button
              ref={triggerRef}
              type="button"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              disabled={anyBusy}
              onClick={() => (open ? close() : openMenu())}
              onKeyDown={onTriggerKey}
              className="-mx-1 inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-sm text-ink transition-colors hover:bg-cream-2/70 disabled:cursor-default disabled:opacity-60"
            >
              <span className="truncate">{shown ? shown.name : "Choose a tracker"}</span>
              <Chevron />
            </button>
            {shown && <p className="mt-0.5 text-xs text-muted">{shown.caption}</p>}

            {open && (
              <ul
                ref={listRef}
                id={listId}
                role="listbox"
                tabIndex={-1}
                aria-label="Issue tracker"
                aria-activedescendant={`${listId}-${options[active]?.key}`}
                onKeyDown={onListKey}
                className="card animate-rise absolute left-0 top-full z-20 mt-2 w-[260px] p-1.5 outline-none"
                style={{
                  background: "#fbf8f1",
                  backdropFilter: "none",
                  boxShadow: "0 12px 32px rgba(26,22,18,.16)",
                }}
              >
                {options.map((o, i) => (
                  <li
                    key={o.key}
                    id={`${listId}-${o.key}`}
                    role="option"
                    aria-selected={o.key === selected}
                    onClick={() => choose(o.key)}
                    onMouseEnter={() => setActive(i)}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 transition-colors ${
                      i === active ? "bg-cream-2/70" : ""
                    }`}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border hairline bg-[#fffdf8]">
                      <TrackerLogo kind={o.key} size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.8125rem] text-ink">{o.name}</span>
                      <span className="block truncate text-[0.6875rem] text-muted">
                        {o.caption}
                      </span>
                    </span>
                    {o.key === connected && (
                      <span className="shrink-0 text-[0.6875rem] text-[#2e7d32]">connected</span>
                    )}
                    <span className="w-3 shrink-0 text-accent">
                      {o.key === selected && <Check />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">{actions()}</div>
      </div>

      {message && <p className="mt-2 border-t hairline pt-2 text-xs text-muted">{message}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run components/TrackerPicker.test.tsx`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add components/TrackerPicker.tsx components/TrackerPicker.test.tsx
git commit -m "feat(web): one tracker card with a dropdown, instead of three"
```

---

### Task 6: Wire Integrations to the picker

**Files:**
- Modify: `web/components/Integrations.tsx` (whole file)

- [ ] **Step 1: Replace the card list with the picker**

```tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import TrackerPicker from "./TrackerPicker";
import { TRACKER_DEFS, useTrackerConnect, type TrackerDef } from "./useTrackerConnect";
import type { ProviderKey } from "./provider-labels";

/**
 * The Settings page's issue tracker section. Connections are managed here via
 * the Clerk client API rather than through the `<UserProfile/>` "Connected
 * accounts" panel. The connect/disconnect logic lives in useTrackerConnect
 * (shared with the onboarding wizard); TrackerPicker is the card over it.
 */

function SkeletonCard() {
  return (
    <div className="card flex items-center justify-between gap-3 px-4 py-3.5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="h-10 w-10 shrink-0 rounded-xl bg-cream-2" />
        <div className="min-w-0 flex-1">
          <div className="h-3.5 w-24 rounded bg-cream-2" />
          <div className="mt-2 h-2.5 w-48 max-w-full rounded bg-cream-2" />
        </div>
      </div>
      <div className="h-6 w-20 shrink-0 rounded-full bg-cream-2" />
    </div>
  );
}

const OPTIONS = TRACKER_DEFS.map(({ key, name, caption }) => ({ key, name, caption }));

function defFor(key: ProviderKey): TrackerDef {
  return TRACKER_DEFS.find((d) => d.key === key)!;
}

export default function Integrations() {
  // Which connected trackers can't actually be used. Clerk reports an account
  // as verified while refusing to vend a token for it once the grant goes
  // stale, so "connected" on its own is not the truth - only the server can
  // tell, and it says so here. Fetched after paint: a slow tracker must not
  // hold the page, and until it answers nothing claims to be broken.
  const [stale, setStale] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/trackers/health", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => setStale(Array.isArray(j.stale) ? j.stale : []))
      .catch(() => setStale([]));
  }, []);

  const {
    isLoaded,
    user,
    busy,
    errors,
    setTrackerError,
    isConnected,
    pendingAccount,
    pendingError,
    connect,
    disconnect,
  } = useTrackerConnect("/connections");
  // Set when the inline disconnect ultimately fails (user cancels the
  // reverification, or some other error), so we point them to account settings.
  const [needsAccount, setNeedsAccount] = useState<Record<string, boolean>>({});

  if (!isLoaded || !user) {
    return (
      <section id="integrations" className="scroll-mt-8">
        <h2 className="text-xs uppercase tracking-[0.15em] text-muted">Issue tracker</h2>
        <div className="mt-3">
          <SkeletonCard />
        </div>
      </section>
    );
  }

  const connected = TRACKER_DEFS.find((t) => isConnected(t))?.key ?? null;
  // A tracker whose last attempt didn't finish. Back from the OAuth round trip,
  // that is the one the card should open on, so its error is right there.
  const attempted =
    TRACKER_DEFS.find((t) => errors[t.key] || pendingAccount(t.providerMatch))?.key ?? null;

  async function handleDisconnect(key: ProviderKey) {
    setTrackerError(key, "");
    setNeedsAccount((m) => ({ ...m, [key]: false }));
    const ok = await disconnect(defFor(key));
    // Fall back to the account page, where Clerk's own UI can finish the job.
    if (!ok) setNeedsAccount((m) => ({ ...m, [key]: true }));
  }

  function messageFor(key: ProviderKey): ReactNode {
    const t = defFor(key);
    if (needsAccount[key]) {
      return (
        <>
          Couldn&apos;t remove it here -{" "}
          <Link href="/account" className="text-accent no-underline hover:underline">
            manage connections in account settings
          </Link>
          .
        </>
      );
    }
    if (errors[key]) return errors[key];
    // Only Clerk connections leave a half-finished record behind.
    if (isConnected(t) || !pendingAccount(t.providerMatch)) return null;
    // Show Clerk's actual verification error when it has one - "didn't finish"
    // alone gives the user nothing to act on.
    return ["Last connection didn’t finish", pendingError(t.providerMatch), "click Connect to try again."]
      .filter(Boolean)
      .join(" - ");
  }

  return (
    <section id="integrations" className="scroll-mt-8">
      <h2 className="text-xs uppercase tracking-[0.15em] text-muted">Issue tracker</h2>
      <div className="mt-3">
        <TrackerPicker
          options={OPTIONS}
          connected={connected}
          stale={stale}
          busy={busy}
          initialSelected={connected ? null : attempted}
          messageFor={messageFor}
          onConnect={(key) => connect(defFor(key))}
          onDisconnect={handleDisconnect}
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add components/Integrations.tsx
git commit -m "feat(web): Connections shows the tracker you have, not all three"
```

---

### Task 7: Team roster

**Files:**
- Create: `web/lib/team.ts`, `web/lib/team.test.ts`, `web/lib/org-team.test.ts`
- Modify: `web/lib/org-server.ts`

- [ ] **Step 1: Write the failing tests**

`web/lib/team.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sortTeam, type TeamMember } from "./team";

const m = (userId: string, fullName: string, extra: Partial<TeamMember> = {}): TeamMember => ({
  userId,
  fullName,
  isYou: false,
  filed: 0,
  ...extra,
});

describe("sortTeam", () => {
  it("puts you first", () => {
    const out = sortTeam([m("a", "Ana"), m("r", "Razi", { isYou: true })]);
    expect(out.map((x) => x.fullName)).toEqual(["Razi", "Ana"]);
  });

  it("sorts everyone else by name, ignoring case", () => {
    const out = sortTeam([m("1", "bob"), m("2", "Alice"), m("3", "carol")]);
    expect(out.map((x) => x.fullName)).toEqual(["Alice", "bob", "carol"]);
  });

  it("orders by name, not by tickets filed", () => {
    const out = sortTeam([m("1", "Zoe", { filed: 90 }), m("2", "Adam", { filed: 1 })]);
    expect(out.map((x) => x.fullName)).toEqual(["Adam", "Zoe"]);
  });

  it("keeps two people with the same name in a stable order", () => {
    const out = sortTeam([m("b", "Sam"), m("a", "Sam")]);
    expect(out.map((x) => x.userId)).toEqual(["a", "b"]);
  });

  it("leaves the caller's array alone", () => {
    const input = [m("1", "bob"), m("2", "Alice")];
    sortTeam(input);
    expect(input.map((x) => x.fullName)).toEqual(["bob", "Alice"]);
  });
});
```

`web/lib/org-team.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { getUserList } = vi.hoisted(() => ({ getUserList: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ users: { getUserList } }),
}));

import { getOrgTeam } from "./org-server";

/** org_members for the roster, the org_leaderboard RPC for the counts. */
function stubDb(memberIds: string[], rows: Array<Record<string, string | number>>) {
  const eq = vi
    .fn()
    .mockResolvedValue({ data: memberIds.map((user_id) => ({ user_id })), error: null });
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
  return { db: { from, rpc } as unknown as SupabaseClient, rpc };
}

beforeEach(() => {
  getUserList.mockResolvedValue({
    data: [
      { id: "u1", firstName: "Razi", lastName: "Fezzani", imageUrl: "https://img.test/u1" },
      { id: "u2", firstName: "jonas", lastName: "Weber" },
      { id: "u3", firstName: "Ana", lastName: null },
    ],
  });
});

const ROWS = [
  { user_id: "u2", filed: 31, night: 0, avg_title: 40, prev_filed: 10 },
  { user_id: "u1", filed: 44, night: 2, avg_title: 30, prev_filed: 40 },
];

describe("getOrgTeam", () => {
  it("lists everyone in the org, you first, then by name", async () => {
    const { db } = stubDb(["u1", "u2", "u3"], ROWS);
    const team = await getOrgTeam("linear:acme", "u1", db);
    expect(team.map((x) => x.fullName)).toEqual(["Razi Fezzani", "Ana", "jonas Weber"]);
    expect(team[0].isYou).toBe(true);
    expect(team[0].imageUrl).toBe("https://img.test/u1");
  });

  it("keeps a member who has filed nothing, at zero", async () => {
    const { db } = stubDb(["u1", "u2", "u3"], ROWS);
    const team = await getOrgTeam("linear:acme", "u1", db);
    expect(team.find((x) => x.userId === "u3")?.filed).toBe(0);
  });

  it("carries the titles the podium hands out", async () => {
    const { db } = stubDb(["u1", "u2", "u3"], ROWS);
    const team = await getOrgTeam("linear:acme", "u1", db);
    expect(team.find((x) => x.userId === "u1")?.title).toBe("chief bug officer");
    expect(team.find((x) => x.userId === "u3")?.title).toBe("still warming up");
  });

  it("counts all time", async () => {
    const { db, rpc } = stubDb(["u1", "u2", "u3"], ROWS);
    await getOrgTeam("linear:acme", "u1", db);
    expect(rpc).toHaveBeenCalledWith("org_leaderboard", {
      member_ids: ["u1", "u2", "u3"],
      since: null,
    });
  });

  it("is empty for an org with no members", async () => {
    const { db, rpc } = stubDb([], []);
    expect(await getOrgTeam("linear:acme", "u1", db)).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run lib/team.test.ts lib/org-team.test.ts`
Expected: FAIL, `Failed to resolve import "./team"` and `getOrgTeam is not a function`.

- [ ] **Step 3: Implement `web/lib/team.ts`**

```ts
/**
 * The Settings team list's data, and its order. Pure, and free of server
 * imports, so the component can use the type without pulling in org-server.
 */

export type TeamMember = {
  userId: string;
  /** First and last name when Clerk has them. */
  fullName: string;
  imageUrl?: string;
  isYou: boolean;
  /** Tickets filed, all time. */
  filed: number;
  /** The title they hold on the all-time podium, if any. */
  title?: string;
};

/**
 * You first, then everyone else by name.
 *
 * Alphabetical rather than by tickets on purpose: this is a roster, not a second
 * leaderboard - the podium already ranks people, and a list that reshuffles
 * whenever someone files reads as noise. User id breaks ties so two people with
 * the same name keep their places between renders.
 */
export function sortTeam(members: TeamMember[]): TeamMember[] {
  return [...members].sort(
    (a, b) =>
      Number(b.isYou) - Number(a.isYou) ||
      a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" }) ||
      a.userId.localeCompare(b.userId),
  );
}
```

- [ ] **Step 4: Implement in `web/lib/org-server.ts`**

Add the import `import { sortTeam, type TeamMember } from "@/lib/team";`.

Add, above `getLeaderboards`:

```ts
/**
 * The aggregate groups over briefs, so a teammate with none in the window
 * produces no row at all. Pad them back in at zero: the roster should show the
 * team, not only whoever happened to file.
 */
function padToRoster(rows: LeaderRow[], memberIds: string[]): LeaderRow[] {
  const seen = new Set(rows.map((r) => r.userId));
  return [
    ...rows,
    ...memberIds
      .filter((id) => !seen.has(id))
      .map((userId) => ({ userId, filed: 0, night: 0, avgTitle: 0, prevFiled: 0 })),
  ];
}
```

In `getLeaderboards`, delete the local `padded` helper and its comment, and use it:

```ts
  const month = rankReporters(padToRoster(monthRows, memberIds));
  const all = rankReporters(padToRoster(allRows, memberIds));
```

Add after `getLeaderboards`:

```ts
/**
 * Everyone in the org, for the Settings team list.
 *
 * Built from the podium's own roster (org_members) and aggregate, so the two can
 * never disagree about who is on the team. All-time counts and titles: a roster
 * is not a this-month figure. If the aggregate fails the roster still shows,
 * with zero counts, rather than the team vanishing from Settings.
 */
export async function getOrgTeam(
  orgKeyValue: string,
  viewerId: string,
  db?: SupabaseClient,
): Promise<TeamMember[]> {
  const admin = db ?? createAdminSupabase();
  const memberIds = await getOrgMemberIds(orgKeyValue, admin);
  if (memberIds.length === 0) return [];

  const rows = await leaderboardRows(admin, memberIds, null);
  const ranked = rankReporters(padToRoster(rows, memberIds));
  const names = await lookupNames(ranked.map((r) => r.userId));

  return sortTeam(
    ranked.map((r) => ({
      userId: r.userId,
      fullName: names.get(r.userId)?.fullName ?? "someone",
      imageUrl: names.get(r.userId)?.imageUrl,
      isYou: r.userId === viewerId,
      filed: r.filed,
      title: r.title,
    })),
  );
}
```

In `lookupNames`, return a `fullName` alongside the podium's first name:

```ts
async function lookupNames(
  userIds: string[],
): Promise<Map<string, { name: string; fullName: string; imageUrl?: string }>> {
  const names = new Map<string, { name: string; fullName: string; imageUrl?: string }>();
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return names;
  try {
    const client = await clerkClient();
    const list = await client.users.getUserList({ userId: unique, limit: unique.length });
    for (const u of list.data) {
      const handle = u.username ?? u.primaryEmailAddress?.emailAddress?.split("@")[0];
      // The podium has room for a first name; the team list shows who it is.
      const name = u.firstName ?? handle ?? "someone";
      const fullName = [u.firstName, u.lastName].filter(Boolean).join(" ") || handle || "someone";
      names.set(u.id, { name, fullName, imageUrl: u.imageUrl });
    }
  } catch {
    /* fall back to the placeholder at the call site rather than losing the podium */
  }
  return names;
}
```

- [ ] **Step 5: Run and watch them pass, plus the podium's server tests**

Run: `npx vitest run lib/team.test.ts lib/org-team.test.ts lib/org-server.test.ts lib/podium.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/team.ts lib/team.test.ts lib/org-team.test.ts lib/org-server.ts
git commit -m "feat(web): read the org's roster for Settings"
```

---

### Task 8: TeamList

**Files:**
- Create: `web/components/TeamList.tsx`
- Test: `web/components/TeamList.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import TeamList from "./TeamList";
import type { TeamMember } from "@/lib/team";

afterEach(cleanup);

const m = (userId: string, fullName: string, extra: Partial<TeamMember> = {}): TeamMember => ({
  userId,
  fullName,
  isYou: false,
  filed: 0,
  ...extra,
});

const TEAM = [
  m("u1", "Razi Fezzani", { isYou: true, filed: 44, title: "chief bug officer" }),
  m("u2", "Ana Costa", { filed: 1, title: "still warming up" }),
  m("u3", "Jonas Weber", { filed: 31, title: "the closer" }),
];

describe("TeamList", () => {
  it("names the org, its tracker and its size", () => {
    render(<TeamList members={TEAM} orgName="Acme" providerName="Linear" />);
    expect(screen.getByText("Acme on Linear · 3 people")).toBeTruthy();
  });

  it("lists everyone in the order given, marking you", () => {
    render(<TeamList members={TEAM} orgName="Acme" providerName="Linear" />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Razi Fezzani");
    expect(rows[0].textContent).toContain("you");
    expect(rows[1].textContent).toContain("Ana Costa");
    expect(rows[1].textContent).not.toContain("you");
  });

  it("shows each person's title and tickets", () => {
    render(<TeamList members={TEAM} orgName="Acme" providerName="Linear" />);
    expect(screen.getByText("the closer")).toBeTruthy();
    expect(screen.getByText("44 tickets")).toBeTruthy();
  });

  it("counts one ticket in the singular", () => {
    render(<TeamList members={TEAM} orgName="Acme" providerName="Linear" />);
    expect(screen.getByText("1 ticket")).toBeTruthy();
    expect(screen.queryByText("1 tickets")).toBeNull();
  });

  it("uses the initials of a full name when there is no picture", () => {
    render(<TeamList members={TEAM} orgName="Acme" providerName="Linear" />);
    expect(screen.getByText("RF")).toBeTruthy();
  });

  it("says so when you are the only one", () => {
    render(<TeamList members={[TEAM[0]]} orgName="Acme" providerName="Linear" />);
    expect(screen.getByText("Acme on Linear · just you so far")).toBeTruthy();
  });

  it("renders nothing without a team", () => {
    const { container } = render(<TeamList members={[]} orgName="Acme" providerName="Linear" />);
    expect(container.innerHTML).toBe("");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run components/TeamList.test.tsx`
Expected: FAIL, `Failed to resolve import "./TeamList"`.

- [ ] **Step 3: Implement**

```tsx
import Avatar from "./Avatar";
import type { TeamMember } from "@/lib/team";

/**
 * The org's roster, on Settings.
 *
 * Who is in an org is a fact about tracker tokens (see lib/org.ts), so it used to
 * be invisible: a head count on the team defaults card, and whoever made the
 * podium. This lists everyone the podium ranks, in an order that holds still.
 */
export default function TeamList({
  members,
  orgName,
  providerName,
}: {
  members: TeamMember[];
  orgName: string;
  providerName: string;
}) {
  if (members.length === 0) return null;

  return (
    <section id="team" className="scroll-mt-8">
      <h2 className="font-display text-2xl text-ink">Team</h2>
      <p className="mt-1 text-xs text-muted">
        {orgName} on {providerName} ·{" "}
        {members.length === 1 ? "just you so far" : `${members.length} people`}
      </p>

      <ul className="card thin-scroll mt-4 max-h-[26rem] overflow-y-auto px-4 py-1">
        {members.map((member) => (
          <li
            key={member.userId}
            className="flex items-center gap-3 border-b hairline py-2.5 last:border-b-0"
          >
            <Avatar name={member.fullName} imageUrl={member.imageUrl} size={30} />
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate text-sm text-ink">
                {member.fullName}
                {member.isYou && <span className="ml-1 text-[0.6875rem] text-accent">you</span>}
              </span>
              {member.title && (
                <span className="truncate text-[0.6875rem] italic text-muted">{member.title}</span>
              )}
            </span>
            <span className="shrink-0 text-xs text-muted">
              {member.filed} {member.filed === 1 ? "ticket" : "tickets"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run components/TeamList.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add components/TeamList.tsx components/TeamList.test.tsx
git commit -m "feat(web): a team list, so you can see who is in your org"
```

---

### Task 9: Settings page, nav, and error copy

**Files:**
- Modify: `web/app/(main)/connections/page.tsx`, `web/components/Nav.tsx`, `web/lib/trackers/registry.ts:120,156`, `web/lib/linear.ts:33`, `web/lib/github.ts:27`, `web/lib/agent/run-processing.ts:271`

- [ ] **Step 1: The page**

```tsx
import { requireUserId } from "@/lib/auth";
import IntegrationsClient from "@/components/IntegrationsClient";
import TeamList from "@/components/TeamList";
import TicketPreferences from "@/components/TicketPreferences";
import { getTrackerContext } from "@/lib/briefs-server";
import { getOrg, getOrgTeam } from "@/lib/org-server";
import { getGuidanceContext } from "@/lib/settings";
import { providerName } from "@/lib/trackers/registry";

export default async function ConnectionsPage() {
  const userId = await requireUserId();
  const [ctx, guidance, team] = await Promise.all([
    getTrackerContext(),
    getGuidanceContext(userId),
    // Best-effort, like the podium: no org, or a failed read, means no section.
    getOrg(userId)
      .then(async (org) => (org ? { org, members: await getOrgTeam(org.key, userId) } : null))
      .catch(() => null),
  ]);

  // GitHub is the only tracker that can be connected without resolving to an
  // org, because a user belongs to several at once. When that's the case the
  // editor offers the picker instead of guessing.
  const needsGithubOrg = ctx.connected.includes("github") && !guidance.hasOrg;

  return (
    // The app shell is wide (for the tickets table); forms read better narrow,
    // so clamp this page and center it in the shell.
    <div className="mx-auto w-full max-w-[760px]">
      <h1 className="font-display text-3xl leading-none text-ink">Settings</h1>

      <div className="mt-7 flex flex-col gap-8">
        <IntegrationsClient />
        {team && (
          <TeamList
            members={team.members}
            orgName={team.org.name}
            providerName={providerName(team.org.provider)}
          />
        )}
        <TicketPreferences {...guidance} needsGithubOrg={needsGithubOrg} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Nav label** (`Nav.tsx`): `{ href: "/connections", label: "Settings" }`, and the doc comment reads "(Dashboard / Tickets / Settings)".

- [ ] **Step 3: Error copy.** Replace "Connections" with "Settings" in these strings, leaving the rest of each sentence alone:
  - `registry.ts:120` `... in Connections, then retry.` becomes `... in Settings, then retry.`
  - `registry.ts:156`, `linear.ts:33`, `github.ts:27`, `run-processing.ts:271` `... under Connections, then retry.` becomes `... under Settings, then retry.`

- [ ] **Step 4: Verify nothing else still says it**

Run: `grep -rn "under Connections\|in Connections" app components lib --include=*.ts --include=*.tsx`
Expected: no output.

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc exit 0; every test passes (353 before, plus the new ones).

- [ ] **Step 6: Commit**

```bash
git add "app/(main)/connections/page.tsx" components/Nav.tsx lib/trackers/registry.ts lib/linear.ts lib/github.ts lib/agent/run-processing.ts
git commit -m "feat(web): Connections becomes Settings, with the team on it"
```

---

### Task 10: Visual check and gates

- [ ] **Step 1:** Temporarily add `web/app/dev/preview/page.tsx` (guarded by `process.env.NODE_ENV === "development"`, `notFound()` otherwise) plus a `"use client"` wrapper that renders `TrackerPicker` with no-op callbacks. It renders the podium with five, two and one people, every TrackerPicker state (connected, switch preview, nothing connected, stale, open), and a TeamList. Temporarily add `"/dev/(.*)"` to `isPublic` in `web/proxy.ts`. **Neither is committed.**
- [ ] **Step 2:** Start the dev server, screenshot the preview at 1280px and 390px wide, and look at: hats sitting on heads without touching the speech bubble, the open dropdown painting over the section below, the team rows truncating cleanly on a phone.
- [ ] **Step 3:** Delete the preview route and revert `proxy.ts`; `git status` shows neither.
- [ ] **Step 4:** Gates: `npx tsc --noEmit`, `npx vitest run`, `npx eslint` on every changed file, `npx next build` (fall back to `--webpack` if Turbopack refuses the worktree).
- [ ] **Step 5:** Push, open the PR, merge (squash).
