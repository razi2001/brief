// Replay site rules, set on Settings (team and personal) and pulled by the
// extension. Pure; the extension's replay-sites.js applies the same rules when
// matching.
//
//   app.acme.com     that host (any port)
//   localhost:3000   that host on that port
//   *.acme.com       acme.com and every subdomain

export const MAX_REPLAY_SITES = 50;

/** What someone typed -> a stored pattern, or null when it isn't one.
 *  A pasted URL is reduced to its host ("https://app.thunders.ai/x" -> "app.thunders.ai"). */
export function normalizeSitePattern(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let p = input.trim().toLowerCase();
  p = p.replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "");
  const wild = p.startsWith("*.");
  const m = /^(.+?)(?::(\d{1,5}))?$/.exec(wild ? p.slice(2) : p);
  if (!m) return null;
  const [, host, port] = m;
  if (port && (Number(port) < 1 || Number(port) > 65535)) return null;
  const kind = hostKind(host);
  if (!kind) return null;
  // A wildcard needs a real domain under it: not "*.com", "*.localhost" or an IP.
  if (wild && kind !== "domain") return null;
  return `${wild ? "*." : ""}${host}${port ? `:${port}` : ""}`;
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/** "domain" (app.acme.com), "local" (localhost, a LAN name like intranet) or
 *  "ip" (10.0.0.2), or null when it isn't a host at all. */
function hostKind(host: string): "domain" | "local" | "ip" | null {
  if (host.length > 253) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host.split(".").every((n) => Number(n) <= 255) ? "ip" : null;
  }
  const labels = host.split(".");
  if (!labels.every((l) => LABEL.test(l))) return null;
  if (labels.length === 1) return "local";
  return TLD.test(labels[labels.length - 1]) ? "domain" : null;
}

/** Normalized, de-duplicated, capped. Junk entries are dropped. */
export function cleanSiteList(input: unknown): string[] {
  const list = Array.isArray(input) ? input : [];
  const out: string[] = [];
  for (const raw of list) {
    const p = normalizeSitePattern(raw);
    if (p && !out.includes(p)) out.push(p);
    if (out.length >= MAX_REPLAY_SITES) break;
  }
  return out;
}

export function siteMatches(pattern: string, url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  if (pattern.startsWith("*.")) {
    const base = pattern.slice(2);
    return u.hostname === base || u.hostname.endsWith(`.${base}`);
  }
  return pattern.includes(":") ? u.host === pattern : u.hostname === pattern;
}

/** What the extension records on: the team's sites plus the user's own, once each. */
export function mergeSiteLists(team: string[], mine: string[]): string[] {
  return [...new Set([...team, ...mine])];
}
