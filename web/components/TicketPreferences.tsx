"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { diffLines, hasChanges } from "@/lib/text-diff";
import type { GuidanceMode } from "@/lib/guidance";
import {
  Eyebrow,
  buttonClass,
  ghostButtonClass,
  segmentedClass,
  segmentClass,
  fieldFocusClass,
  dialogBackdropClass,
  dialogPanelClass,
} from "./SettingsSection";

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

const textareaClass = `block w-full resize-y rounded-lg border hairline bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted/60 ${fieldFocusClass}`;

type Props = {
  mode: GuidanceMode;
  personal: string;
  org: string;
  orgName: string;
  orgMembers: number;
  hasOrg: boolean;
  orgUpdatedByName: string;
  orgUpdatedAt: string | null;
  /** Unused here now: the GitHub org picker lives in the Team section. */
  needsGithubOrg?: boolean;
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
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
  const router = useRouter();

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
      router.refresh(); // the row's summary
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
      router.refresh();
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

  const footer = (text: string) => <span className="text-xs text-muted">{text}</span>;

  return (
    <div>
      <div className="card divide-y divide-[var(--color-hairline)]">
        {props.hasOrg && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            <div className={segmentedClass}>
              {(
                [
                  ["inherit", "Use team defaults"],
                  ["override", "Use my own"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => switchMode(value)}
                  aria-pressed={mode === value}
                  className={segmentClass(mode === value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted">
              {props.orgName} · {members === 1 ? "just you" : `${members} people`}
            </span>
          </div>
        )}

        {props.hasOrg && mode === "inherit" && (
          <div className="px-4 py-4">
            <Eyebrow
              aside={
                updatedBy && (
                  <span className="text-xs text-muted">
                    {updatedBy}
                    {props.orgUpdatedAt ? ` · ${timeAgo(props.orgUpdatedAt)}` : ""}
                  </span>
                )
              }
            >
              Team defaults
            </Eyebrow>
            <textarea
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              rows={5}
              spellCheck={false}
              placeholder={PLACEHOLDER}
              aria-label="Team defaults"
              className={`mt-2 ${textareaClass}`}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={!orgDirty || orgState === "saving"}
                className={buttonClass}
              >
                {orgState === "saved" ? "Saved ✓" : "Save for the team"}
              </button>
              {footer(
                members === 1
                  ? `Default for anyone who joins ${props.orgName}`
                  : `For everyone in ${props.orgName} using the team defaults`,
              )}
            </div>
          </div>
        )}

        {(!props.hasOrg || mode === "override") && (
          <div className="px-4 py-4">
            <Eyebrow>Your preferences</Eyebrow>
            <textarea
              value={personal}
              onChange={(e) => setPersonal(e.target.value)}
              rows={5}
              spellCheck={false}
              placeholder={PLACEHOLDER}
              aria-label="Your preferences"
              className={`mt-2 ${textareaClass}`}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => savePersonal()}
                disabled={personalState === "saving"}
                className={buttonClass}
              >
                {personalState === "saving" ? "Saving…" : personalState === "saved" ? "Saved ✓" : "Save"}
              </button>
              {footer("Only affects your tickets")}
            </div>
          </div>
        )}
      </div>

      {error && <p className="mt-2.5 text-xs text-[#c62828]">{error}</p>}

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
    </div>
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
      className={dialogBackdropClass}
      onClick={onCancel}
    >
      <div
        className={dialogPanelClass}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-semibold text-ink">
          {solo ? `Set the defaults for ${orgName}?` : `Change defaults for ${members} people?`}
        </h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          {solo
            ? `You're the only one here so far. These apply to you now, and become the starting point for anyone who joins ${orgName}.`
            : `This changes how Brief files tickets for everyone in ${orgName} who hasn't set their own override.`}
        </p>

        <div className="mt-3.5 max-h-56 overflow-y-auto rounded-lg border hairline bg-surface-2 px-3 py-2.5 font-mono text-[12px] leading-relaxed">
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

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={ghostButtonClass}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={saving} className={buttonClass}>
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
export function GithubOrgPicker({ orgs }: { orgs: Array<{ login: string; avatarUrl?: string }> }) {
  // The orgs come from the server render (lib/github listGithubOrgs), so the
  // row opens on its choices instead of an empty box while they load.
  const router = useRouter();
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

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

  return (
    <div>
      <Eyebrow>Your GitHub organization</Eyebrow>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {orgs.map((o) => (
          <button
            key={o.login}
            type="button"
            onClick={() => pick(o.login)}
            disabled={!!saving}
            className={`${ghostButtonClass} gap-2`}
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
