import { CHROME_STORE_URL } from "@/lib/chrome-store";

/**
 * The Guide's content: one lesson per feature, in the order a new user meets
 * them. Copy rules: short, conversational, no em or en dashes
 * (lessons.test.ts checks), and only what the product really does.
 *
 * Step text has a tiny markup: **bold**, *italic*, [[Ctrl+K]] for keys,
 * [label](https://...) for a link. Each step is one frame group of the
 * lesson's scene (components/guide/scenes), so a scene has exactly as many
 * steps as its lesson.
 */

export type GroupKey = "start" | "first" | "more";

export const GROUPS: ReadonlyArray<{ key: GroupKey; title: string }> = [
  { key: "start", title: "Get started" },
  { key: "first", title: "Your first ticket" },
  { key: "more", title: "Go further" },
];

export type SceneKey = "install" | "connect" | "rules" | "record" | "replay" | "create" | "editticket" | "briefit";

/** Facts the server knows, which tick a lesson on their own. */
export type AutoKey = "tracker" | "extension" | "brief" | "rules" | "replaySites";

export type SandboxKey = "editor";

export type TryIt =
  /** Play with it right here, nothing saved. */
  | { kind: "sandbox"; sandbox: SandboxKey }
  /** The real thing lives elsewhere in the app. */
  | { kind: "link"; href: string; label: string }
  | { kind: "install" }
  | { kind: "mark" };

export type Lesson = {
  slug: string;
  group: GroupKey;
  title: string;
  blurb: string;
  steps: string[];
  scene: SceneKey;
  tryIt: TryIt;
  auto?: AutoKey;
};

export const LESSONS: readonly Lesson[] = [
  {
    slug: "install-extension",
    group: "start",
    title: "Install the extension",
    blurb: "You capture bugs in Chrome, right on the page where they happen.",
    steps: [
      `Add [Brief Cloud](${CHROME_STORE_URL}) from the Chrome Web Store.`,
      "A setup tab opens: click **Grant microphone access**, then **Allow**.",
      "The tab moves on to Brief Cloud and connects the extension to your account: *Connected*.",
      "Pin it: the puzzle icon, then the pin next to Brief Cloud.",
    ],
    scene: "install",
    tryIt: { kind: "install" },
    auto: "extension",
  },
  {
    slug: "connect-tracker",
    group: "start",
    title: "Connect your tracker",
    blurb:
      "Brief files tickets straight into Linear, Jira, GitHub, GitLab, Azure DevOps, ClickUp, Notion, Trello, Asana or Monday.",
    steps: [
      "Open **Settings** and click the **Tracker** row.",
      "Choose yours from the list, then **Connect**.",
      "Allow Brief on your tracker's page.",
      "Back in Settings, the row says *Connected*.",
    ],
    scene: "connect",
    tryIt: { kind: "link", href: "/connections", label: "Open Settings" },
    auto: "tracker",
  },
  {
    slug: "ticket-rules",
    group: "start",
    title: "Ticket rules and Replay",
    blurb: "Two settings worth a minute: how your tickets are written, and where Brief keeps the last minute.",
    steps: [
      "Open **Settings**, then **Ticket rules**.",
      "Write them like you'd tell a teammate: *UI bugs get the Frontend label.* Then **Save**.",
      "Under **Replay**, add your app's address, then **Add**. Brief keeps the last minute there.",
      "Every new ticket follows your rules. With a team, use the team's settings or your own.",
    ],
    scene: "rules",
    tryIt: { kind: "link", href: "/connections", label: "Open Settings" },
    auto: "rules",
  },
  {
    slug: "record",
    group: "first",
    title: "Video and screenshots",
    blurb: "Show the bug and talk it through, or point at it. Brief writes the ticket from what it sees and hears.",
    steps: [
      "Click the Brief icon, then **Add**, then **Video**. After 3, 2, 1 it records the tab and your voice.",
      "Do what breaks it, and say what you expected. Then click the orange stop button.",
      "Need to cut it? Open the video to trim, crop or **Mark** a moment, then **Save**.",
      "For a still: **Add**, then **Screenshot**. Draw in red to point at the issue, then **Save**.",
      "Click a screenshot to add a note. Up to 3 per brief.",
    ],
    scene: "record",
    tryIt: { kind: "mark" },
  },
  {
    slug: "replay",
    group: "first",
    title: "Replay the last minute",
    blurb: "On your Replay sites, Brief keeps the last 60 seconds. Nothing to start, nothing to reproduce.",
    steps: [
      "Something broke on a Replay site? Click **Add**, then **Replay**.",
      "Trim to the moment that matters, then **Add to brief**.",
      "It becomes a video, with every click and call for the ticket.",
    ],
    scene: "replay",
    tryIt: { kind: "mark" },
  },
  {
    slug: "create-or-draft",
    group: "first",
    title: "Create the ticket",
    blurb: "One click, and Brief writes the ticket and files it while you get on with your day.",
    steps: [
      "Add a line under **Additional data** if you like. The video often says enough.",
      "Click **Create in** your tracker. It flies to the cloud and says *Ticket queued*. You can close the popup.",
      "Brief writes it and files it. It shows up in **Tickets** with your tracker's status.",
      "Open **▾** to change what the button does. **Save draft** writes it up on a page anyone can open, no account needed, and copies the link. **Fix prompt** copies a prompt for your coding agent. Your pick stays.",
    ],
    scene: "create",
    tryIt: { kind: "link", href: "/tickets", label: "Open Tickets" },
    auto: "brief",
  },
  {
    slug: "edit-ticket",
    group: "more",
    title: "Edit a ticket",
    blurb: "Every ticket and draft is a page you can edit in place. It saves as you type.",
    steps: [
      "Open a ticket from **Tickets** or **Drafts** and click into the text.",
      "Select a passage: **H**, **B**, *I* and Code format it.",
      "**Improve** or **Shorten** rewrites just the selection.",
      "Anything else: press [[Ctrl+K]] and ask the assistant.",
    ],
    scene: "editticket",
    tryIt: { kind: "sandbox", sandbox: "editor" },
  },
  {
    slug: "brief-it",
    group: "more",
    title: "Brief it in one click",
    blurb: "Something just broke on a Replay site? One right click, and Brief drafts the bug from the last minute.",
    steps: [
      "Right click the page and pick **Brief it**.",
      "The Brief icon turns while it looks back: failed calls, errors, clicks that did nothing.",
      "A green check: the draft is written, with a video and a still of each moment.",
      "Find it in **Drafts**, check it, file it.",
    ],
    scene: "briefit",
    tryIt: { kind: "mark" },
  },
];

export function lessonBySlug(slug: string): Lesson | undefined {
  return LESSONS.find((l) => l.slug === slug);
}

export function neighbours(slug: string): { prev?: Lesson; next?: Lesson } {
  const i = LESSONS.findIndex((l) => l.slug === slug);
  if (i < 0) return {};
  return { prev: LESSONS[i - 1], next: LESSONS[i + 1] };
}

/** The lesson's place in the path, from 1. */
export function lessonNumber(slug: string): number {
  return LESSONS.findIndex((l) => l.slug === slug) + 1;
}

export const LESSON_SLUGS = LESSONS.map((l) => l.slug);
