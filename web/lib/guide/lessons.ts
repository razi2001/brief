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

export type SceneKey = "install" | "connect" | "rules" | "record" | "replay" | "create" | "bugbash" | "briefit";

/** Facts the server knows, which tick a lesson on their own. */
export type AutoKey = "tracker" | "extension" | "brief" | "rules" | "replaySites";

export type TryIt =
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
    title: "Record and talk, or screenshot",
    blurb: "Show the bug and talk it through, or point at it. Brief writes the ticket from what it sees and hears.",
    steps: [
      "Click the Brief icon, then **Record and talk**. After 3, 2, 1 it records the tab and your voice.",
      "Do what breaks it, and say what you expected. Then click the orange stop button.",
      "Need to cut it? Open the video to trim, crop or **Mark** a moment, then **Save**.",
      "For a still: **+ Add**, then **Screenshot**. Draw in red to point at the issue, then **Save**. Its arrow sets a 3 or 6 second delay, to open a menu first.",
      "Click a screenshot and say what is wrong on it. Up to 3 per brief.",
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
      "Something broke on a Replay site? Click the Brief icon, then **Last minute**.",
      "Trim to the moment that matters.",
      "Click **Record voice** and say what went wrong while it plays. The ticket uses what you say. Then **Add to brief**.",
      "It becomes a video, with your voice and every click and call for the ticket.",
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
      "Say what went wrong and what you expected in the field under Evidence, if you like. The video often says enough.",
      "Click **Create in** your tracker. It flies to the cloud and says *Ticket queued*. You can close the popup.",
      "Brief writes it and files it. It shows up in **Tickets** with your tracker's status. **Tags** sorts them into folders.",
      "Open **▾** to change what the button does. **Share link** writes it up on a page anyone can open, no account needed, copies the link and keeps it under **Drafts** in **Tickets**. **Fix prompt** copies a prompt for your coding agent and opens it there: Claude Code, Codex, Cursor or VS Code, picked once. Your pick stays.",
    ],
    scene: "create",
    tryIt: { kind: "link", href: "/tickets", label: "Open Tickets" },
    auto: "brief",
  },

  {
    slug: "quality-competition",
    group: "more",
    title: "Run a quality competition",
    blurb: "Get the team testing one area for a set time. Everyone files from the extension, and a board shows who found the most.",
    steps: [
      "Open **Quality competition**, then **New quality competition**. Name it, pick the dates and the time each person gets. **Suggested** offers the areas your tickets keep breaking in.",
      "Leave **Review before filing** on to keep the reports as drafts until you check them. Click **Create**, then **Copy invite link** and send it.",
      "Each person clicks **Join**, then **Start** when it suits them. Their own clock starts: nobody has to test at the same time.",
      "While the clock runs, the popup shows the quality competition and the time left. Every brief counts for it. Its switch leaves one out.",
      "The board ranks who found the most. Once it closes, the reports wait in groups of the same bug: check them, then file each group as one ticket.",
    ],
    scene: "bugbash",
    tryIt: { kind: "link", href: "/competition", label: "Open Quality competition" },
  },  {
    slug: "brief-it",
    group: "more",
    title: "Brief it in one click",
    blurb: "Something just broke on a Replay site? One right click, and Brief drafts the bug from the last minute.",
    steps: [
      "Right click the page and pick **Brief it**.",
      "The Brief icon turns while it looks back: failed calls, errors, clicks that did nothing.",
      "A green check: the draft is written, with a video and a still of each moment.",
      "Find it under **Drafts** in **Tickets**, check it, file it.",
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
