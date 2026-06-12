"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BrandMark from "./BrandMark";
import { TrackerLogo } from "./TrackerLogo";
import { TRACKER_DEFS, useTrackerConnect } from "./useTrackerConnect";
import { ROLES, SOURCES } from "@/lib/onboarding-options";

const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/brief/dbceddgckljkggbghaddpclblfbkmfig";

type Step = "you" | "tracker" | "extension";
const STEP_ORDER: Step[] = ["you", "tracker", "extension"];

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
    you: "you",
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

/** A labelled grid of single-select chips. */
function ChipGrid({
  label,
  options,
  selected,
  onSelect,
  columns = 2,
}: {
  label: string;
  options: { label: string; icon?: string }[];
  selected: string;
  onSelect: (v: string) => void;
  columns?: number;
}) {
  return (
    <div>
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted">
        {label}
      </p>
      <div
        className="mt-2.5 grid gap-2"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {options.map((o) => {
          const active = selected === o.label;
          return (
            <button
              key={o.label}
              type="button"
              onClick={() => onSelect(active ? "" : o.label)}
              aria-pressed={active}
              className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left font-mono text-[0.8125rem] transition-colors ${
                active
                  ? "border-accent bg-[rgba(221,105,54,.1)] text-accent"
                  : "border-hairline bg-[#fffdf8] text-ink-2 hover:border-[rgba(221,105,54,.4)] hover:text-ink"
              }`}
            >
              {o.icon && (
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[0.75rem] ${
                    active ? "bg-[rgba(221,105,54,.16)] text-accent" : "bg-cream-2 text-muted"
                  }`}
                >
                  {o.icon}
                </span>
              )}
              <span className="min-w-0 truncate">{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The first-run onboarding experience — a dedicated full page (/welcome), not
 * a dashboard widget. New sign-ups land here straight from Clerk (no hop
 * through "/"). Three steps: about you (role + how you heard) → connect a
 * tracker (inline Clerk OAuth) → install the extension. Finishing or skipping
 * stamps privateMetadata.onboardedAt and heads to the dashboard.
 */
export default function Onboarding({
  initialRole,
  initialSource,
  greetingName,
}: {
  initialRole: string;
  initialSource: string;
  greetingName: string;
}) {
  const router = useRouter();
  const { isLoaded, busy, errors, connectedAccount, pendingError, connect } =
    useTrackerConnect("/welcome");
  const trackerConnected = TRACKER_DEFS.some((t) => !!connectedAccount(t.providerMatch));

  // `rawStep` is null until the user manually navigates; before that the step
  // is DERIVED from real state. This matters because returning from the
  // tracker's OAuth is a full page reload (in-memory step is lost): if a
  // tracker is now connected we resume at "extension", if the role was already
  // saved we resume at "tracker", otherwise we start at "you".
  const [rawStep, setStep] = useState<Step | null>(null);
  const [role, setRole] = useState(initialRole);
  const [source, setSource] = useState(initialSource);
  const [savingYou, setSavingYou] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const autoStep: Step = trackerConnected ? "extension" : initialRole ? "tracker" : "you";
  const step: Step = rawStep ?? autoStep;

  async function submitYou() {
    if (savingYou) return;
    setSavingYou(true);
    // Persist whatever's filled; both are optional. Best-effort — advance regardless.
    await saveSettings({ role, source });
    setSavingYou(false);
    setStep("tracker");
  }

  async function finish() {
    if (finishing) return;
    setFinishing(true);
    await saveSettings({ onboardedAt: true });
    router.replace("/dashboard");
  }

  const stepTitle: Record<Step, string> = {
    you: "tell us about you.",
    tracker: "connect your tracker.",
    extension: "install the extension.",
  };
  const stepSub: Record<Step, string> = {
    you: "Brief uses this to write tickets the way your team expects them.",
    tracker: "Brief writes tickets straight into it — no copy-paste, ever.",
    extension: "this is how you capture a bug: record, talk, done.",
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

          {/* ---- Step 1: you (role + source) ---- */}
          {step === "you" && (
            <div className="mt-6 flex flex-col gap-6">
              <ChipGrid
                label="What do you do?"
                options={ROLES}
                selected={role}
                onSelect={setRole}
                columns={2}
              />
              <ChipGrid
                label="How'd you hear about Brief?"
                options={SOURCES.map((s) => ({ label: s }))}
                selected={source}
                onSelect={setSource}
                columns={2}
              />
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={submitYou}
                  disabled={savingYou}
                  className="btn-accent cursor-pointer disabled:opacity-60"
                >
                  {savingYou ? "Saving…" : "Continue →"}
                </button>
              </div>
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
                  onClick={() => setStep("you")}
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
                <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[rgba(46,125,50,.35)] bg-[rgba(46,125,50,.1)] px-3 py-1 font-mono text-xs text-[#2e7d32]">
                  tracker connected ✓
                </p>
              )}

              <a
                href={CHROME_STORE_URL}
                target="_blank"
                rel="noreferrer"
                className="btn-accent inline-flex w-full items-center justify-center gap-2.5 py-3.5 no-underline sm:w-auto"
              >
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Add Brief to Chrome
              </a>

              <p className="mt-4 text-sm leading-relaxed text-muted">
                Already installed? Open Brief from your toolbar and hit{" "}
                <span className="text-ink">Connect to Brief Cloud</span> — it pairs
                with this account in one click. Then record a bug and it files itself.
              </p>

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
