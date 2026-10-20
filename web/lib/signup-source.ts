/**
 * Where a sign-up came from. get-brief.app adds these to its sign-up links
 * (which button, its utm tags, the referring site); the sign-up page hands
 * them to Clerk, which copies them onto the new user's unsafeMetadata.signup.
 */
const KEYS = ["src", "utm_source", "utm_medium", "utm_campaign", "ref"] as const;
const MAX = 60;

export type SignupSource = Partial<Record<(typeof KEYS)[number], string>>;

export function signupSource(params: Record<string, string | string[] | undefined>): SignupSource | null {
  const out: SignupSource = {};
  for (const k of KEYS) {
    const raw = params[k];
    const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, MAX);
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}
