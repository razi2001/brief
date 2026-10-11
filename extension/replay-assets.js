// Brief - which URLs in a replayed page a still has to fetch (replay-render.js)
//
// A still is the page's HTML painted from an SVG <foreignObject>, which can't
// load anything itself: what it draws (images, a video's poster, stylesheets,
// SVG images, CSS url()s) is fetched once and inlined as data: URLs. Nothing
// else is: a link's target, a favicon, a preload or a frame would only cost a
// fetch (and a CORS error in chrome://extensions) for nothing on screen.

const TAG = /<([a-zA-Z][\w:-]*)\b([^>]*)>/g;
const ATTR = /\s(src|href|xlink:href|poster)="([^"]+)"/g;
const CSS_URL = /url\((['"]?)([^'")]+)\1\)/g;
const NO_SRC = /^(?:iframe|frame|script|audio|embed|object)$/i;
const DRAWN_HREF = /^(?:image|use|feimage)$/i;

/** The raw URL values (as written in the html) a picture of it needs. */
export function assetUrls(html) {
  const found = new Set();
  for (const m of html.matchAll(CSS_URL)) found.add(m[2]);
  for (const [, tag, attrs] of html.matchAll(TAG)) {
    for (const [, name, value] of attrs.matchAll(ATTR)) {
      const keep = name === 'src' ? !NO_SRC.test(tag)
        : name === 'poster' ? true
        : DRAWN_HREF.test(tag) || (/^link$/i.test(tag) && /\brel="[^"]*\bstylesheet\b/i.test(attrs));
      if (keep) found.add(value);
    }
  }
  return found;
}
