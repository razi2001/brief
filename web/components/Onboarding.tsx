"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

function StepDots({ current, trackerDone }: { current: Step; trackerDone: boolean }) {
  const labels: Record<Step, string> = {
    role: "you",
    tracker: "tracker",
    extension: "extension",
  };
  const currentIdx = STEP_ORDER.indexOf(current);
  return (
    <ol className="flex items-center gap-4">
      {STEP_ORDER.map((s, i) => {
        const done = i < currentIdx || (s === "tracker" && trackerDone && currentIdx > 0);
        const active = s === current;
        return (
          <li key={s} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`flex h-5 w-5 items-center justify-center rounded-full border text-[0.625rem] ${
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
              className={`font-mono text-[0.625rem] uppercase tracking-[0.12em] ${
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
 * First-run onboarding wizard, shown on the dashboard until finished or
 * skipped (privateMetadata.onboardedAt). Three quick steps: who you are →
 * connect a tracker (inline Clerk OAuth, same flow as Connections) → install &
 * pair the extension. Replaces the old static "Getting started" checklist.
 */
export default function Onboarding({
  initialRole,
  greetingName,
}: {
  initialRole: string;
  greetingName: string;
}) {
  const router = useRouter();
  const { isLoaded, busy, errors, connectedAccount, connect } = useTrackerConnect("/dashboard");
  const trackerConnected = TRACKER_DEFS.some((t) => !!connectedAccount(t.providerMatch));

  const [rawStep, setStep] = useState<Step>(initialRole ? "tracker" : "role");
  const [role, setRole] = useState(initialRole);
  const [customRole, setCustomRole] = useState("");
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Derived, not an effect: coming back from the tracker's OAuth consent lands
  // on /dashboard with the account now verified — render the extension step
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
    router.refresh();
  }

  return (
    <section className="mt-10">
      <div className="card animate-rise px-5 py-6 sm:px-7 sm:py-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-3xl leading-tight text-ink">
              welcome, {greetingName}.
            </h2>
            <p className="mt-1 text-sm text-muted">
              two minutes of setup, then your bugs file themselves.
            </p>
          </div>
          <StepDots current={step} trackerDone={trackerConnected} />
        </div>

        {/* ---- Step 1: role ---- */}
        {step === "role" && (
          <div className="mt-6">
            <p className="text-sm text-ink">
              First — what do you do? Brief uses this to write tickets the way
              your team expects them.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={saving}
                  onClick={() => chooseRole(r)}
                  className={`pill cursor-pointer transition-colors disabled:opacity-50 ${
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
              className="mt-3 flex items-center gap-2"
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
                className="w-56 max-w-full rounded-lg border hairline bg-[#fffdf8] px-3 py-1.5 font-mono text-xs text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-accent"
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
            <p className="text-sm text-ink">
              Connect your tracker — Brief writes tickets straight into it.
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              {TRACKER_DEFS.map((t) => {
                const isBusy = !!busy[t.key];
                const error = errors[t.key];
                return (
                  <div key={t.key}>
                    <button
                      type="button"
                      onClick={() => connect(t)}
                      disabled={!isLoaded || isBusy}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border hairline bg-[#fffdf8] px-4 py-3 text-left transition-colors hover:border-[rgba(221,105,54,.45)] disabled:opacity-60"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <TrackerLogo kind={t.key} size={18} />
                        <span className="min-w-0">
                          <span className="block text-sm text-ink">{t.name}</span>
                          <span className="block text-xs text-muted">{t.caption}</span>
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-xs text-accent">
                        {isBusy ? "Connecting…" : "Connect →"}
                      </span>
                    </button>
                    {error && <p className="mt-1.5 px-1 text-xs text-muted">{error}</p>}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between">
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
            {trackerConnected ? (
              <p className="text-sm text-ink">
                Tracker connected ✓ — last thing: the capture side.
              </p>
            ) : (
              <p className="text-sm text-ink">
                Last thing: the capture side.{" "}
                <span className="text-muted">
                  (You can connect a tracker any time from Connections.)
                </span>
              </p>
            )}
            <ol className="mt-4 flex flex-col gap-3 text-sm text-ink-2">
              <li className="flex gap-3">
                <span className="font-mono text-xs text-accent">1.</span>
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
                  from the Chrome Web Store and pin it.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-xs text-accent">2.</span>
                <span>
                  Click <span className="text-ink">✦</span> in your toolbar, then the
                  cloud button — it pairs with this account in one click.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-xs text-accent">3.</span>
                <span>
                  See a bug? Hit <span className="text-ink">✦</span>, talk through it,
                  stop — the ticket writes and files itself. No typing.
                </span>
              </li>
            </ol>
            <div className="mt-5 flex items-center justify-between">
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
                {finishing ? "Saving…" : "All set — let's go"}
              </button>
            </div>
          </div>
        )}

        {/* Quiet escape hatch — never trap the user in a wizard. */}
        {step !== "extension" && (
          <div className="mt-5 border-t hairline pt-3 text-right">
            <button
              type="button"
              onClick={finish}
              disabled={finishing}
              className="font-mono text-[0.6875rem] text-muted no-underline hover:text-ink hover:underline disabled:opacity-60"
            >
              skip setup
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
