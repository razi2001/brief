"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { diffLines, hasChanges } from "@/lib/text-diff";
import type { GuidanceMode } from "@/lib/guidance";

/**
 * Ticket guidance editor: the team's shared defaults, and this user's personal
 * override.
 *
 * The override REPLACES the team defaults rather than adding to them, so the
 * page has to make three things obvious at a glance - what the team's rules
 * are, whether you're following them, and which text is actually reaching the
 * agent. That's what the "applies to you" marker on each card is for.
 *
 * Saving the team defaults goes through a confirmation dialog, because it
 * changes how tickets get filed for other people. Saving your own doesn't.
 *
 * The team card shows even when you are the only member: teammates arrive
 * later and inherit whatever is set here, so the copy switches to say exactly
 * that rather than claiming a change affects "1 person" - which would be you.
 */

const PLACEHOLDER = `e.g. Status: Backlog. Priority: Medium.
Label every ticket "inbound".
Bugs → Engineering, features → Product.`;

const textareaClass =
  "block w-full resize-y rounded-xl border hairline bg-[#fffdf8] px-3.5 py-3 font-mono text-[13px] leading-relaxed text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-accent";

type Props = {
  mode: GuidanceMode;
  personal: string;
  org: string;
  orgName: string;
  orgMembers: number;
  hasOrg: boolean;
  orgUpdatedByName: string;
  orgUpdatedAt: string | null;
  /** GitHub is connected but the user hasn't said which org is theirs. */
  needsGithubOrg: boolean;
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Small "this is the one in force" marker, so the two cards can't be confused. */
function AppliesBadge() {
  return (
    <span className="pill border-[rgba(221,105,54,.35)] bg-[rgba(221,105,54,.1)] text-accent">
      applies to you
    </span>
  );
}

export default function TicketPreferences(props: Props) {
  const [mode, setMode] = useState<GuidanceMode>(props.mode);
  const [personal, setPersonal] = useState(props.personal ?? "");
  // Both trimmed, and the diff below compares trimmed to trimmed: otherwise a
  // stored trailing newline reads as an unsaved change and arms "Save for the
  // team" before the user has typed anything.
  const [org, setOrg] = useState((props.org ?? "").trim());
  const [orgSaved, setOrgSaved] = useState((props.org ?? "").trim());
  const [updatedBy, setUpdatedBy] = useState(props.orgUpdatedByName);
  const [members, setMembers] = useState(props.orgMembers);

  const [personalState, setPersonalState] = useState<"idle" | "saving" | "saved">("idle");
  const [orgState, setOrgState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const diff = useMemo(() => diffLines(orgSaved, org.trim()), [orgSaved, org]);
  const orgDirty = hasChanges(diff);

  async function savePersonal(nextMode: GuidanceMode = mode) {
    setError("");
    setPersonalState("saving");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          ticketGuidance: personal,
          ticketGuidanceMode: nextMode,
        }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setPersonalState("saved");
      setTimeout(() => setPersonalState((s) => (s === "saved" ? "idle" : s)), 1800);
    } catch (e) {
      setPersonalState("idle");
      setError(e instanceof Error ? e.message : "Couldn't save - please try again.");
    }
  }

  async function saveOrg() {
    setError("");
    setOrgState("saving");
    try {
      const res = await fetch("/api/org/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ticketGuidance: org }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `save failed (${res.status})`);
      setOrgSaved(org.trim());
      if (typeof j.members === "number") setMembers(j.members);
      if (j.updatedByName) setUpdatedBy(j.updatedByName);
      setOrgState("saved");
      setConfirming(false);
      setTimeout(() => setOrgState((s) => (s === "saved" ? "idle" : s)), 1800);
    } catch (e) {
      setOrgState("idle");
      setError(e instanceof Error ? e.message : "Couldn't save - please try again.");
    }
  }

  /** Switching mode is itself a preference change, so it saves immediately. */
  function switchMode(next: GuidanceMode) {
    if (next === mode) return;
    setMode(next);
    void savePersonal(next);
  }

  return (
    <section id="ticket-preferences" className="scroll-mt-8">
      <h2 className="font-display text-2xl text-ink">Ticket preferences</h2>
      <p className="mt-1 text-xs text-muted">
        Guidance the agent follows when writing tickets - tone, labels, where things go.
      </p>

      {props.needsGithubOrg && <GithubOrgPicker />}

      {props.hasOrg && (
        <div className="card mt-4 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-xl text-ink">Team defaults</h3>
            <div className="flex items-center gap-2">
              {mode === "inherit" && <AppliesBadge />}
              <span className="pill text-muted">
                {props.orgName} ·{" "}
                {members === 1 ? "just you" : `${members} people`}
              </span>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted">
            {updatedBy
              ? `Last changed by ${updatedBy}${
                  props.orgUpdatedAt ? ` on ${timeAgo(props.orgUpdatedAt)}` : ""
                }`
              : "Nobody has set these yet."}
          </p>

          <textarea
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            rows={5}
            spellCheck={false}
            placeholder={PLACEHOLDER}
            className={`mt-3 ${textareaClass}`}
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={!orgDirty || orgState === "saving"}
              className="pill cursor-pointer border-[rgba(221,105,54,.35)] bg-[rgba(221,105,54,.1)] text-accent transition-colors hover:bg-[rgba(221,105,54,.18)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {orgState === "saved" ? "Saved ✓" : "Save for the team"}
            </button>
            <span className="text-xs text-muted">
              {members === 1
                ? `Becomes the default for anyone who joins ${props.orgName}`
                : "Changes filing for everyone without their own override"}
            </span>
          </div>
        </div>
      )}

      <div className="card mt-4 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-xl text-ink">
            {props.hasOrg ? "Your override" : "Your preferences"}
          </h3>
          {mode === "override" && <AppliesBadge />}
        </div>

        {props.hasOrg && (
          <div className="mt-3 inline-flex overflow-hidden rounded-full border hairline">
            {(
              [
                ["inherit", "Use team defaults"],
                ["override", "Use my own"],
              ] as const
            ).map(([value, label], i) => (
              <button
                key={value}
                type="button"
                onClick={() => switchMode(value)}
                className={`cursor-pointer px-3.5 py-1.5 text-[0.6875rem] uppercase tracking-[0.04em] transition-colors ${
                  i > 0 ? "border-l hairline" : ""
                } ${
                  mode === value
                    ? "bg-[rgba(221,105,54,.12)] text-accent"
                    : "text-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {props.hasOrg && mode === "inherit" ? (
          <div className="mt-3">
            <div className="rounded-xl border hairline bg-[rgba(26,22,18,.03)] px-3.5 py-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-muted">
              {orgSaved || "No team defaults set yet."}
            </div>
            <p className="mt-2 text-xs text-muted">
              Following {props.orgName}. Switch to “Use my own” to write your own.
            </p>
          </div>
        ) : (
          <>
            <textarea
              value={personal}
              onChange={(e) => setPersonal(e.target.value)}
              rows={5}
              spellCheck={false}
              placeholder={PLACEHOLDER}
              className={`mt-3 ${textareaClass}`}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => savePersonal()}
                disabled={personalState === "saving"}
                className="pill cursor-pointer border-[rgba(221,105,54,.35)] bg-[rgba(221,105,54,.1)] text-accent transition-colors hover:bg-[rgba(221,105,54,.18)] disabled:opacity-50"
              >
                {personalState === "saving"
                  ? "Saving…"
                  : personalState === "saved"
                    ? "Saved ✓"
                    : "Save"}
              </button>
              <span className="text-xs text-muted">
                {props.hasOrg
                  ? "Replaces the team defaults - only for you"
                  : "Only affects your tickets"}
              </span>
            </div>
          </>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-[#c62828]">{error}</p>}

      {confirming && (
        <ConfirmDialog
          members={members}
          solo={members === 1}
          orgName={props.orgName}
          diff={diff}
          saving={orgState === "saving"}
          onCancel={() => setConfirming(false)}
          onConfirm={saveOrg}
        />
      )}
    </section>
  );
}

/**
 * The blast-radius confirmation.
 *
 * A bare "are you sure?" would be noise. This one earns the interruption by
 * naming how many people it affects and showing exactly which lines change, so
 * the answer is actually informed.
 */
function ConfirmDialog({
  members,
  solo,
  orgName,
  diff,
  saving,
  onCancel,
  onConfirm,
}: {
  members: number;
  /** You are the only member - nobody else is affected YET. */
  solo: boolean;
  orgName: string;
  diff: ReturnType<typeof diffLines>;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm team default change"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(26,22,18,.45)] px-4"
      onClick={onCancel}
    >
      <div
        className="ai-float w-full max-w-md rounded-[15px] border hairline bg-[#fffdf8] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-xl text-ink">
          {solo ? `Set the defaults for ${orgName}?` : `Change defaults for ${members} people?`}
        </h3>
        <p className="mt-1.5 text-xs text-muted">
          {solo
            ? `You're the only one here so far. These apply to you now, and become the starting point for anyone who joins ${orgName}.`
            : `This changes how Brief files tickets for everyone in ${orgName} who hasn't set their own override.`}
        </p>

        <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border hairline bg-[rgba(26,22,18,.03)] px-3 py-2.5 font-mono text-[12px] leading-relaxed">
          {diff.map((line, i) => (
            <div
              key={i}
              className={
                line.kind === "add"
                  ? "text-[#2e7d32]"
                  : line.kind === "remove"
                    ? "text-[#c62828]"
                    : "text-muted"
              }
            >
              <span aria-hidden className="select-none opacity-60">
                {line.kind === "add" ? "+ " : line.kind === "remove" ? "− " : "  "}
              </span>
              {line.text || " "}
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="pill cursor-pointer text-muted transition-colors hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="pill cursor-pointer border-[rgba(221,105,54,.35)] bg-[rgba(221,105,54,.1)] text-accent transition-colors hover:bg-[rgba(221,105,54,.18)] disabled:opacity-50"
          >
            {saving ? "Updating…" : solo ? "Save team defaults" : "Update for everyone"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * GitHub-only: which of your orgs is "your team"?
 *
 * Linear and Jira tokens each point at exactly one workspace, so they never ask.
 * A GitHub user belongs to many orgs at once and we refuse to guess - until
 * this is answered they have no org, which is the safe default.
 */
function GithubOrgPicker() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Array<{ login: string; avatarUrl?: string }>>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/org/github", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => setOrgs(j.orgs ?? []))
      .catch(() => setOrgs([]))
      .finally(() => setLoaded(true));
  }, []);

  async function pick(login: string) {
    setError("");
    setSaving(login);
    try {
      const res = await fetch("/api/org/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ login }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Couldn't save that choice.");
      // Picking an org changes what the whole page renders (team defaults
      // appear, the picker goes away), and all of that is server-rendered -
      // so re-run the server render rather than patching state here.
      router.refresh();
    } catch (e) {
      setSaving("");
      setError(e instanceof Error ? e.message : "Couldn't save that choice.");
    }
  }

  if (!loaded) return null;

  // No orgs found. Saying nothing would leave the user with no team defaults
  // and no reason why - so explain it, because the cause is almost always one
  // of two fixable things.
  if (orgs.length === 0) {
    return (
      <div className="card mt-4 px-4 py-4">
        <h3 className="font-display text-xl text-ink">No GitHub org found</h3>
        <p className="mt-1 text-xs text-muted">
          Shared preferences need a workspace to attach to. We look for GitHub
          organizations that own repositories you can reach - if you only file into
          your own personal repositories, there isn&apos;t one yet. Your own preferences
          below still apply.
        </p>
      </div>
    );
  }

  return (
    <div className="card mt-4 px-4 py-4">
      <h3 className="font-display text-xl text-ink">Which GitHub org is your team?</h3>
      <p className="mt-1 text-xs text-muted">
        You&apos;re in {orgs.length} - pick the one you share ticket preferences with.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {orgs.map((o) => (
          <button
            key={o.login}
            type="button"
            onClick={() => pick(o.login)}
            disabled={!!saving}
            className="pill cursor-pointer gap-1.5 transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {o.avatarUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={o.avatarUrl} alt="" className="h-4 w-4 rounded-full" />
            )}
            {saving === o.login ? "Saving…" : o.login}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-[#c62828]">{error}</p>}
    </div>
  );
}
