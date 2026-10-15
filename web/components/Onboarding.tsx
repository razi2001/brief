"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BrandMark from "./BrandMark";
import StandalonePage, { SHEET } from "./StandalonePage";
import { TrackerLogo } from "./TrackerLogo";
import { NOT_AVAILABLE, TRACKER_DEFS, useTrackerConnect } from "./useTrackerConnect";
import { ROLES, SOURCES } from "@/lib/onboarding-options";
import { CHROME_STORE_URL } from "@/lib/chrome-store";

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

function Check({ size = 9 }: { size?: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 6.2 5 8.5l4.5-5" />
    </svg>
  );
}

function StepRail({ current, trackerDone }: { current: Step; trackerDone: boolean }) {
  const labels: Record<Step, string> = {
    you: "You",
    tracker: "Tracker",
    extension: "Extension",
  };
  const currentIdx = STEP_ORDER.indexOf(current);
  return (
    <ol className="flex items-center gap-2 sm:gap-3">
      {STEP_ORDER.map((s, i) => {
        const done = i < currentIdx || (s === "tracker" && trackerDone && currentIdx > 0);
        const active = s === current;
        return (
          <li key={s} className="flex items-center gap-2 sm:gap-3">
            {i > 0 && <span aria-hidden="true" className="h-px w-4 bg-hairline sm:w-8" />}
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-semibold tabular-nums transition-colors ${
                  done
                    ? "bg-accent/12 text-accent"
                    : active
                      ? "bg-accent text-white"
                      : "border hairline bg-surface text-muted"
                }`}
              >
                {done ? <Check /> : i + 1}
              </span>
              <span
                className={`text-[13px] ${active ? "font-medium text-ink" : done ? "text-ink-2" : "text-muted"}`}
              >
                {labels[s]}
              </span>
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
      <p className="text-[13px] font-medium text-ink-2">{label}</p>
      <div
        className="mt-2 grid gap-1.5"
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
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[13px] transition-colors ${
                active
                  ? "border-accent/50 bg-accent/[0.06] text-ink shadow-[0_0_0_1px_rgba(221,105,54,.2)]"
                  : "hairline bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink"
              }`}
            >
              {o.icon && (
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] ${
                    active ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted"
                  }`}
                >
                  {o.icon}
                </span>
              )}
              <span className="min-w-0 leading-snug">{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The first-run onboarding experience - a dedicated full page (/welcome), not
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
  const { isLoaded, busy, errors, notice, isConnected, isAvailable, pendingError, connect } =
    useTrackerConnect("/welcome");
  const trackerConnected = TRACKER_DEFS.some(isConnected);

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
    // Persist whatever's filled; both are optional. Best-effort - advance regardless.
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

  // The step is derived from the connections, and the owned ones need a round
  // trip: until they're in, a user back from connecting Asana would see the
  // tracker step flash before the extension step.
  if (!isLoaded && rawStep === null) {
    return (
      <StandalonePage>
        <div className={`${SHEET} w-full max-w-[560px] overflow-hidden`} aria-busy="true">
          <div className="px-6 pb-5 pt-7 sm:px-8 sm:pt-8">
            <div className="h-8 w-60 max-w-full rounded-md bg-surface-2" />
            <div className="mt-2.5 h-3 w-72 max-w-full rounded bg-surface-2" />
            <div className="mt-6 h-[18px] w-64 max-w-full rounded bg-surface-2" />
          </div>
          <div className="h-[420px] border-t hairline" />
        </div>
      </StandalonePage>
    );
  }

  // One connect at a time: each one navigates away.
  const anyBusy = Object.values(busy).some(Boolean);

  const stepTitle: Record<Step, string> = {
    you: "Tell us about you",
    tracker: "Connect your tracker",
    extension: "Install the extension",
  };
  const stepSub: Record<Step, string> = {
    you: "Brief uses this to write tickets the way your team expects them.",
    tracker: "Brief writes tickets straight into it - no copy-paste, ever.",
    extension: "This is how you capture a bug: record, talk, done.",
  };

  const backLink = "text-[13px] text-muted no-underline transition-colors hover:text-ink";

  return (
    <StandalonePage>
      <div className="w-full max-w-[560px]">
        <div className={`${SHEET} overflow-hidden`}>
          {/* Greeting + where you are */}
          <div className="px-6 pb-5 pt-7 sm:px-8 sm:pt-8">
            <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              Welcome, {greetingName}
            </h1>
            <p className="mt-1 text-[13px] text-muted">
              Two minutes of setup, then your bugs file themselves.
            </p>
            <div className="mt-5">
              <StepRail current={step} trackerDone={trackerConnected} />
            </div>
          </div>

          <div className="animate-rise border-t hairline px-6 py-6 sm:px-8 sm:py-7" key={step}>
            <h2 className="text-[15px] font-semibold text-ink">{stepTitle[step]}</h2>
            <p className="mt-1 text-[13px] text-muted">{stepSub[step]}</p>

            {/* ---- Step 1: you (role + source) ---- */}
            {step === "you" && (
              <div className="mt-5 flex flex-col gap-5">
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
              </div>
            )}

            {/* ---- Step 2: tracker ---- */}
            {step === "tracker" && (
              <div className="mt-5 flex flex-col gap-2">
                {notice && <p className="px-1 text-xs text-[#b54328]">{notice}</p>}
                {TRACKER_DEFS.map((t) => {
                  const isBusy = !!busy[t.key];
                  const available = isAvailable(t);
                  // A click-time error wins; otherwise show why the LAST
                  // attempt didn't finish (Clerk's real verification error).
                  // The row already says when it isn't available yet.
                  const clicked = !available && errors[t.key] === NOT_AVAILABLE ? "" : errors[t.key];
                  const error = clicked || (t.providerMatch ? pendingError(t.providerMatch) : "");
                  return (
                    <div key={t.key}>
                      <button
                        type="button"
                        onClick={() => connect(t)}
                        disabled={!isLoaded || anyBusy || !available}
                        className="flex w-full items-center justify-between gap-3 rounded-lg border hairline bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-2 disabled:opacity-60 disabled:hover:bg-surface"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border hairline bg-surface-2">
                            <TrackerLogo kind={t.key} size={16} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13px] font-medium text-ink">{t.name}</span>
                            <span className="block truncate text-xs text-muted">{t.caption}</span>
                          </span>
                        </span>
                        {available ? (
                          <span className="shrink-0 text-[13px] font-medium text-accent">
                            {isBusy ? "Connecting…" : "Connect"}
                          </span>
                        ) : (
                          <span className="shrink-0 text-xs text-muted">{NOT_AVAILABLE}</span>
                        )}
                      </button>
                      {error && (
                        <p className="mt-1.5 px-1 text-xs text-[#b54328]">{error}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ---- Step 3: extension ---- */}
            {step === "extension" && (
              <div className="mt-5 flex flex-col gap-4">
                {trackerConnected && (
                  <span className="pill w-fit border-[rgba(46,125,50,.3)] bg-[rgba(46,125,50,.08)] text-[#2e7d32]">
                    <Check size={10} />
                    Tracker connected
                  </span>
                )}

                {/* Install card - groups the store action with its two setup steps
                    so the button doesn't float in empty space. */}
                <div className="overflow-hidden rounded-xl border hairline bg-surface">
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="flex items-center gap-3">
                      <BrandMark size={36} className="shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-ink">Brief for Chrome</p>
                        <p className="mt-0.5 text-xs text-muted">Free · Chrome Web Store</p>
                      </div>
                    </div>
                    <a
                      href={CHROME_STORE_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-accent shrink-0 no-underline"
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      Add to Chrome
                    </a>
                  </div>

                  <ol className="flex flex-col gap-2.5 border-t hairline bg-surface-2/60 px-4 py-3.5">
                    <li className="flex items-start gap-2.5 text-[13px] text-ink-2">
                      <span className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border hairline bg-surface text-[10px] font-semibold tabular-nums text-muted">
                        1
                      </span>
                      <span>Pin Brief to your toolbar so it&apos;s one click away.</span>
                    </li>
                    <li className="flex items-start gap-2.5 text-[13px] text-ink-2">
                      <span className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border hairline bg-surface text-[10px] font-semibold tabular-nums text-muted">
                        2
                      </span>
                      <span>
                        Open it and hit{" "}
                        <span className="font-medium text-ink">Connect to Brief Cloud</span> - it
                        pairs with this account instantly. Then record a bug and it
                        files itself.
                      </span>
                    </li>
                  </ol>
                </div>
              </div>
            )}
          </div>

          {/* Footer: back on the left, the step's forward action on the right */}
          <div className="flex items-center justify-between gap-3 border-t hairline bg-surface-2/60 px-6 py-3.5 sm:px-8">
            {step === "you" && (
              <>
                <span />
                <button
                  type="button"
                  onClick={submitYou}
                  disabled={savingYou}
                  className="btn-accent cursor-pointer disabled:opacity-60"
                >
                  {savingYou ? "Saving…" : "Continue"}
                </button>
              </>
            )}
            {step === "tracker" && (
              <>
                <button type="button" onClick={() => setStep("you")} className={backLink}>
                  Back
                </button>
                <button type="button" onClick={() => setStep("extension")} className="btn cursor-pointer">
                  I&apos;ll connect it later
                </button>
              </>
            )}
            {step === "extension" && (
              <>
                {/* With a tracker connected the tracker step has nothing left to
                    do (and would immediately bounce forward) - hide "back". */}
                {trackerConnected ? (
                  <span />
                ) : (
                  <button type="button" onClick={() => setStep("tracker")} className={backLink}>
                    Back
                  </button>
                )}
                <button
                  type="button"
                  onClick={finish}
                  disabled={finishing}
                  className="btn cursor-pointer disabled:opacity-60"
                >
                  {finishing ? "Saving…" : "All set, take me home"}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Quiet escape hatch - never trap the user in a wizard. */}
        {step !== "extension" && (
          <p className="mt-4 text-center">
            <button
              type="button"
              onClick={finish}
              disabled={finishing}
              className="text-xs text-muted no-underline transition-colors hover:text-ink disabled:opacity-60"
            >
              Skip setup, straight home
            </button>
          </p>
        )}
      </div>
    </StandalonePage>
  );
}
