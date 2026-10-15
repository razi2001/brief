"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProviderKey } from "./provider-labels";
import type { Workspace } from "@/lib/tracker";
import { Eyebrow, ghostButtonClass } from "./SettingsSection";

/**
 * Which of your tracker's workspaces is your team?
 *
 * Linear and Jira tokens each point at exactly one workspace, so they never
 * ask. Other trackers can see several (GitHub orgs, GitLab groups, ClickUp
 * workspaces...) and we refuse to guess: until this is answered the user has
 * no org, which is the safe default. For Azure DevOps and Asana the answer is
 * also where tickets get filed.
 */
export default function WorkspacePicker({
  provider,
  providerName,
  noun,
  workspaces,
}: {
  provider: ProviderKey;
  providerName: string;
  noun: string;
  workspaces: Workspace[];
}) {
  // The workspaces come from the server render (lib/workspaces), so the row
  // opens on its choices instead of an empty box while they load.
  const router = useRouter();
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();

  async function pick(id: string) {
    setError("");
    setSaving(id);
    try {
      const res = await fetch("/api/org/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ provider, id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Couldn't save that choice.");
      // Picking changes what the whole page renders (team defaults appear, the
      // picker goes away), and all of that is server-rendered, so re-run the
      // server render rather than patching state here. In a transition so the
      // button keeps saying Saving until the new page is in.
      startTransition(() => {
        setSaving("");
        router.refresh();
      });
    } catch (e) {
      setSaving("");
      setError(e instanceof Error ? e.message : "Couldn't save that choice.");
    }
  }

  return (
    <div>
      <Eyebrow>{`Your ${providerName} ${noun}`}</Eyebrow>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {workspaces.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => pick(w.id)}
            disabled={!!saving}
            className={`${ghostButtonClass} gap-2`}
          >
            {w.avatarUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={w.avatarUrl} alt="" className="h-4 w-4 rounded-full" />
            )}
            {saving === w.id ? "Saving…" : w.name}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-[#c62828]">{error}</p>}
    </div>
  );
}
