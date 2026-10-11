/**
 * Page addresses without their tracking junk. Marketing and analytics tools
 * hang long query parameters on every link (`_gl`, `_ga_*`, `_gcl_au`,
 * `utm_*`, `gclid`…). They mean nothing to whoever reads the ticket, and
 * their underscores turn a pasted URL into italic gibberish in Markdown.
 * Everything that addresses the page - the path, the real query, the #route
 * of a single-page app - is kept as it was.
 */
const TRACKING = /^(?:_gl|_ga(?:_.*)?|_gac(?:_.*)?|_gcl(?:_.*)?|_fplc|_hs[a-z_]*|__hs[a-z_]*|_ke|utm_.*|gclid|gbraid|wbraid|dclid|fbclid|msclkid|yclid|twclid|ttclid|li_fat_id|mc_cid|mc_eid|igshid|ref_src|ref_url|hsCtaTracking|vero_id|oly_[a-z_]+|s_kwcid)$/i;

export function cleanUrl(url: string): string;
export function cleanUrl(url: string | null | undefined): string | null | undefined;
export function cleanUrl(url: string | null | undefined): string | null | undefined {
  if (!url || typeof url !== "string") return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k));
  if (keep.length === [...u.searchParams.keys()].length) return url; // nothing to strip: untouched
  const q = new URLSearchParams(keep).toString();
  return `${u.origin}${u.pathname}${q ? `?${q}` : ""}${u.hash}`;
}
