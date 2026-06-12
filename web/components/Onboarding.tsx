"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BrandMark from "./BrandMark";
import { TrackerLogo } from "./TrackerLogo";
import { TRACKER_DEFS, useTrackerConnect } from "./useTrackerConnect";

const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/brief/dbceddgckljkggbghaddpclblfbkmfig";

const ROLES = [
  "Engineer",
  "QA / Tester",
  "Product manager",
  "Designer",
  "Support",
  "Founder",
];

type Step = "role" | "tracker" | "extension";
const STEP_ORDER: Step[] = ["role", "tracker", "extension"];

/** Fire-and-await settings write; failures surface as a return value. */
async function saveSettings(body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function StepRail({ current, trackerDone }: { current: Step; trackerDone: boolean }) {
  const labels: Record<Step, string> = {
    role: "you",
    tracker: "your tracker",
    extension: "the extension",
  };
  const currentIdx = STEP_ORDER.indexOf(current);
  return (
    <ol className="flex items-center justify-center gap-3 sm:gap-5">
      {STEP_ORDER.map((s, i) => {
        const done = i < currentIdx || (s === "tracker" && trackerDone && currentIdx > 0);
        const active = s === current;
        return (
          <li key={s} className="flex items-center gap-2">
            {i > 0 && (
              <span aria-hidden="true" className="mr-1 hidden h-px w-6 bg-hairline sm:mr-3 sm:block sm:w-10" />
            )}
            <span
              aria-hidden="true"
              className={`flex h-6 w-6 items-center justify-center rounded-full border text-[0.6875rem] transition-colors ${
                done
                  ? "border-[rgba(221,105,54,.4)] bg-[rgba(221,105,54,.1)] text-accent"
                  : active
                    ? "border-accent bg-accent text-cream"
                    : "border-hairline bg-cream-2 text-muted"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={`font-mono text-[0.6875rem] uppercase tracking-[0.12em] ${
                active ? "text-ink" : "text-muted"
              }`}
            >
              {labels[s]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The first-run onboarding experience — a dedicated full page (/welcome), not
 * a dashboard widget. New sign-ups land here straight from Clerk (no hop
 * through "/"). Three steps: who you are → connect a tracker (inline Clerk
 * OAuth) → install & pair the extension. Finishing or skipping stamps
 * privateMetadata.onboardedAt and heads to the dashboard.
 */
export default function Onboarding({
  initialRole,
  greetingName,
}: {
  initialRole: string;
  greetingName: string;
}) {
  const router = useRouter();
  const { isLoaded, busy, errors, connectedAccount, pendingError, connect } =
    useTrackerConnect("/welcome");
  const trackerConnected = TRACKER_DEFS.some((t) => !!connectedAccount(t.providerMatch));

  const [rawStep, setStep] = useState<Step>(initialRole ? "tracker" : "role");
  const [role, setRole] = useState(initialRole);
  const [customRole, setCustomRole] = useState("");
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Derived, not an effect: coming back from the tracker's OAuth consent lands
  // back on /welcome with the account now verified — render the extension step
  // straight away (the tracker step has nothing left to do).
  const step: Step =
    rawStep === "tracker" && isLoaded && trackerConnected ? "extension" : rawStep;

  async function chooseRole(r: string) {
    if (saving) return;
    setSaving(true);
    setRole(r);
    await saveSettings({ role: r }); // best-effort; the wizard moves on regardless
    setSaving(false);
    setStep("tracker");
  }

  async function finish() {
    if (finishing) return;
    setFinishing(true);
    await saveSettings({ onboardedAt: true });
    router.replace("/dashboard");
  }

  const stepTitle: Record<Step, string> = {
    role: "first — what do you do?",
    tracker: "connect your tracker.",
    extension: "add the capture side.",
  };
  const stepSub: Record<Step, string> = {
    role: "Brief uses this to write tickets the way your team expects them.",
    tracker: "Brief writes tickets straight into it — no copy-paste, ever.",
    extension: "the ✦ button in Chrome is where bugs go in.",
  };

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-10 text-ink sm:py-14">
      {/* Brand moment */}
      <div className="flex flex-col items-center text-center">
        <BrandMark size={48} />
        <h1 className="font-display mt-5 text-4xl leading-tight sm:text-5xl">
          welcome, <em className="italic text-accent">{greetingName}</em>.
        </h1>
        <p className="mt-2 max-w-md text-sm text-muted">
          two minutes of setup, then your bugs file themselves.
        </p>
      </div>

      <div className="mt-8 w-full max-w-[620px]">
        <StepRail current={step} trackerDone={trackerConnected} />

        <div className="card animate-rise mt-6 px-6 py-7 sm:px-8 sm:py-8" key={step}>
          <h2 className="font-display text-2xl leading-snug sm:text-3xl">
            {stepTitle[step]}
          </h2>
          <p className="mt-1.5 text-sm text-muted">{stepSub[step]}</p>

          {/* ---- Step 1: role ---- */}
          {step === "role" && (
            <div className="mt-6">
              <div className="flex flex-wrap gap-2.5">
                {ROLES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={saving}
                    onClick={() => chooseRole(r)}
                    className={`cursor-pointer rounded-full border px-4 py-2 font-mono text-[0.8125rem] transition-colors disabled:opacity-50 ${
                      role === r
                        ? "border-accent bg-[rgba(221,105,54,.14)] text-accent"
                        : "border-hairline bg-[#fffdf8] text-ink-2 hover:border-[rgba(221,105,54,.45)] hover:text-accent"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <form
                className="mt-4 flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (customRole.trim()) chooseRole(customRole.trim());
                }}
              >
                <input
                  type="text"
                  value={customRole}
                  onChange={(e) => setCustomRole(e.target.value)}
                  maxLength={60}
                  placeholder="or type your own…"
                  className="w-60 max-w-full rounded-lg border hairline bg-[#fffdf8] px-3.5 py-2 font-mono text-[0.8125rem] text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-accent"
                />
                {customRole.trim() && (
                  <button
                    type="submit"
                    disabled={saving}
                    className="pill cursor-pointer border-[rgba(221,105,54,.35)] bg-[rgba(221,105,54,.1)] text-accent transition-colors hover:bg-[rgba(221,105,54,.18)] disabled:opacity-50"
                  >
                    That&apos;s me →
                  </button>
                )}
              </form>
            </div>
          )}

          {/* ---- Step 2: tracker ---- */}
          {step === "tracker" && (
            <div className="mt-6">
              <div className="flex flex-col gap-3">
                {TRACKER_DEFS.map((t) => {
                  const isBusy = !!busy[t.key];
                  // A click-time error wins; otherwise show why the LAST
                  // attempt didn't finish (Clerk's real verification error).
                  const error = errors[t.key] || pendingError(t.providerMatch);
                  return (
                    <div key={t.key}>
                      <button
                        type="button"
                        onClick={() => connect(t)}
                        disabled={!isLoaded || isBusy}
                        className="flex w-full items-center justify-between gap-3 rounded-xl border hairline bg-[#fffdf8] px-4 py-3.5 text-left transition-colors hover:border-[rgba(221,105,54,.45)] disabled:opacity-60"
                      >
                        <span className="flex min-w-0 items-center gap-3.5">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border hairline bg-cream-2/50">
                            <TrackerLogo kind={t.key} size={20} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm text-ink">{t.name}</span>
                            <span className="block text-xs text-muted">{t.caption}</span>
                          </span>
                        </span>
                        <span className="shrink-0 font-mono text-xs text-accent">
                          {isBusy ? "Connecting…" : "Connect →"}
                        </span>
                      </button>
                      {error && (
                        <p className="mt-1.5 px-1 text-xs text-[#b54328]">{error}</p>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-5 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep("role")}
                  className="font-mono text-xs text-muted no-underline hover:text-ink hover:underline"
                >
                  ← back
                </button>
                <button
                  type="button"
                  onClick={() => setStep("extension")}
                  className="font-mono text-xs text-muted no-underline hover:text-accent hover:underline"
                >
                  I&apos;ll connect it later →
                </button>
              </div>
            </div>
          )}

          {/* ---- Step 3: extension ---- */}
          {step === "extension" && (
            <div className="mt-6">
              {trackerConnected && (
                <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-[rgba(46,125,50,.35)] bg-[rgba(46,125,50,.1)] px-3 py-1 font-mono text-xs text-[#2e7d32]">
                  tracker connected ✓
                </p>
              )}
              <ol className="flex flex-col gap-4 text-sm text-ink-2">
                <li className="flex gap-3.5">
                  <span className="font-mono text-xs leading-6 text-accent">1.</span>
                  <span>
                    Add the{" "}
                    <a
                      href={CHROME_STORE_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent no-underline hover:underline"
                    >
                      Brief extension
                    </a>{" "}
                    from the Chrome Web Store and pin it to your toolbar.
                  </span>
                </li>
                <li className="flex gap-3.5">
                  <span className="font-mono text-xs leading-6 text-accent">2.</span>
                  <span>
                    Click <span className="text-ink">✦</span>, then the cloud button —
                    it pairs with this account in one click.
                  </span>
                </li>
                <li className="flex gap-3.5">
                  <span className="font-mono text-xs leading-6 text-accent">3.</span>
                  <span>
                    See a bug? Hit <span className="text-ink">✦</span>, talk through
                    it, stop — the ticket writes and files itself. No typing.
                  </span>
                </li>
              </ol>
              <div className="mt-7 flex items-center justify-between">
                {/* With a tracker connected the tracker step has nothing left to
                    do (and would immediately bounce forward) — hide "back". */}
                {trackerConnected ? (
                  <span />
                ) : (
                  <button
                    type="button"
                    onClick={() => setStep("tracker")}
                    className="font-mono text-xs text-muted no-underline hover:text-ink hover:underline"
                  >
                    ← back
                  </button>
                )}
                <button
                  type="button"
                  onClick={finish}
                  disabled={finishing}
                  className="btn-accent cursor-pointer disabled:opacity-60"
                >
                  {finishing ? "Saving…" : "All set — open my dashboard"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Quiet escape hatch — never trap the user in a wizard. */}
        {step !== "extension" && (
          <p className="mt-4 text-center">
            <button
              type="button"
              onClick={finish}
              disabled={finishing}
              className="font-mono text-[0.6875rem] text-muted no-underline hover:text-ink hover:underline disabled:opacity-60"
            >
              skip setup — straight to the dashboard
            </button>
          </p>
        )}
      </div>

      <footer className="mt-auto pt-10 text-center">
        <p className="font-display text-sm italic text-muted">
          what&apos;s the <em className="text-accent">brief</em>?
        </p>
      </footer>
    </main>
  );
}
