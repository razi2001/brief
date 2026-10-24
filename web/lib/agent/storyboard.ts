import { image, text, type Part } from "./responses";
import type { BriefInput } from "./process-brief";

// What every ticket writer (the filing agent, the draft writer, the live
// draft stream) shows the model besides the context block: the images as a
// labelled, ordered storyboard, and the note on how to read it all together.

const mmss = (ms?: number): string | null => {
  if (typeof ms !== "number" || !isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * The images, each after a label: a keyframe gets "Frame i of N (M:SS into
 * the capture) on <page>" so the model reads the frames as a timed sequence
 * it can line up with the timeline, a replay still its time and page, and a
 * screenshot the reporter's note on it.
 */
export function storyboardParts(images: BriefInput["images"]): Part[] {
  const frameCount = images.filter((i) => i.name.includes("keyframe")).length;
  const replayCount = images.filter((i) => i.name.includes("replay-frame")).length;
  const shotCount = images.filter((i) => i.name.includes("screenshot")).length;
  let frameIdx = 0;
  let replayIdx = 0;
  let shotIdx = 0;
  const onPage = (u?: string) => (u ? ` on ${u}` : "");
  const parts: Part[] = [];
  for (const img of images) {
    let label: string;
    if (img.name.includes("keyframe")) {
      frameIdx++;
      const t = mmss(img.timestampMs);
      const marked = img.caption && img.caption.trim() ? ` - ${img.caption.trim()}` : "";
      label = `Frame ${frameIdx} of ${frameCount}${t ? ` (${t} into the capture)` : ""}${onPage(img.url)}${marked}:`;
    } else if (img.name.includes("replay-frame")) {
      replayIdx++;
      const t = mmss(img.timestampMs);
      const what = img.caption && img.caption.trim() ? ` - ${img.caption.trim()}` : "";
      label = `Replay still ${replayIdx} of ${replayCount}${t ? ` (${t} into the replay)` : ""}${onPage(img.url)}${what}:`;
    } else if (img.name.includes("screenshot")) {
      shotIdx++;
      const base = shotCount > 1 ? `Screenshot ${shotIdx} of ${shotCount}` : "Annotated screenshot";
      const note = img.caption && img.caption.trim() ? ` - the reporter's note on it: "${img.caption.trim()}"` : "";
      label = `${base} (red marks, if any, = where the reporter is pointing)${note}:`;
    } else {
      label = `${img.name}:`;
    }
    parts.push(text(label), image(img.dataUrl));
  }
  return parts;
}

/** How to read the evidence together, led by what the reporter typed or said. */
export function correlateNote(images: BriefInput["images"]): string {
  const frameCount = images.filter((i) => i.name.includes("keyframe")).length;
  const replayCount = images.filter((i) => i.name.includes("replay-frame")).length;
  return (
    "CORRELATE EVERYTHING before writing, led by the reporter's own words (typed, or spoken when nothing was typed). " +
    "Start from what the reporter says the problem is, then use the rest to confirm and flesh it out: " +
    (frameCount ? `the ${frameCount} time-ordered screen frames (a storyboard, each with its time and page: line them up with the timeline), ` : "") +
    (replayCount ? `the ${replayCount} replay stills (what the browser showed just before the report, in order, each with its page URL), ` : "") +
    "any annotated screenshot (red marks = where the reporter is pointing), the narration, the pages and steps, and finally the console/network errors as supporting detail. " +
    "Build a single coherent account of what the user did, what they expected, and what actually happened. The reporter's words define what the ticket is about; the screenshots/frames are ground truth for what is on screen; fix the narration's mis-hearings and treat the console/network errors as extra context, not the headline. " +
    "Account for EVERY screenshot the reporter attached: explain what each one shows and weave in the reporter's note for it, so the evidence is described in the ticket, not just attached. Likewise fold any reporter-provided details (the structured fields) into the body. " +
    "ALWAYS include the page where the problem shows in the ticket (a Context line), as a Markdown link with the page title as its text, never a bare URL. When the capture went through several pages, pick the one where the reporter reacts, marks it, or where it fails, not simply the first."
  );
}
