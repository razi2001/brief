"use client";

import { useState, type ClipboardEvent } from "react";
import { useRouter } from "next/navigation";
import { normalizeSitePattern, MAX_REPLAY_SITES } from "@/lib/replay-sites";
import { Eyebrow, buttonClass } from "./SettingsSection";

/**
 * Replay, on Settings: the sites the extension keeps the last minute on. Like
 * Ticket preferences, two lists: the team's (when the tracker resolves to an
 * org; everyone in it records there) and your own (always; only you). The
 * extension records on both.
 */
export default function ReplaySites({
  team,
  mine,
}: {
  team: { name: string; sites: string[] } | null;
  mine: string[];
}) {
  return (
    <div className="card divide-y divide-[var(--color-hairline)]">
      {team && (
        <SiteList
          label="Team"
          tag={team.name}
          initial={team.sites}
          save={async (sites) => {
            const res = await fetch("/api/org/replay-sites", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ sites }),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
            return j.sites as string[];
          }}
        />
      )}
      <SiteList
        label={team ? "Only you" : undefined}
        initial={mine}
        save={async (sites) => {
          const res = await fetch("/api/settings", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ replaySites: sites }),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
          return j.replaySites as string[];
        }}
      />
    </div>
  );
}

// One list: the sites as chips, then the field to add one. Every change saves
// the whole list at once; a failed save puts the previous list back.
function SiteList({
  label,
  tag,
  initial,
  save: send,
}: {
  label?: string;
  tag?: string;
  initial: string[];
  save: (sites: string[]) => Promise<string[]>;
}) {
  const [sites, setSites] = useState<string[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function save(next: string[]) {
    const prev = sites;
    setSites(next);
    setSaving(true);
    setError(null);
    try {
      const saved = await send(next);
      // A signed-out session answers with the sign-in page, not a list.
      if (!Array.isArray(saved)) throw new Error("Couldn't save. Reload and try again.");
      setSites(saved);
      router.refresh(); // the row's summary
    } catch (e) {
      setSites(prev);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-4">
      {label && <Eyebrow aside={tag && <span className="pill text-muted">{tag}</span>}>{label}</Eyebrow>}
      {sites.length > 0 && (
        <ul className={`${label ? "mt-3" : ""} flex flex-wrap gap-1.5`}>
          {sites.map((s) => (
            <li key={s}>
              <SiteChip site={s} disabled={saving} onRemove={() => save(sites.filter((x) => x !== s))} />
            </li>
          ))}
        </ul>
      )}
      <SiteField
        full={sites.length >= MAX_REPLAY_SITES}
        busy={saving}
        onAdd={(p) => { if (!sites.includes(p)) save([...sites, p]); }}
      />
      {error && <p className="mt-2 text-xs text-[#c62828]">{error}</p>}
    </div>
  );
}

function SiteChip({ site, disabled, onRemove }: { site: string; disabled: boolean; onRemove: () => void }) {
  const wild = site.startsWith("*.");
  return (
    <span className="inline-flex h-8 items-center gap-1 rounded-lg border hairline bg-[#fffdf8] pl-2.5 pr-1 font-mono text-[13px] text-ink">
      {wild && <span className="text-accent">*.</span>}
      {wild ? site.slice(2) : site}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${site}`}
        className="ml-0.5 grid h-6 w-6 cursor-pointer place-items-center rounded-md text-muted transition hover:bg-[#c62828]/10 hover:text-[#c62828]"
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}

/**
 * A site, not free text: "https://" is fixed in front, the subdomain switch
 * puts "*." before the host, and the host is checked as you type (the same
 * check the server applies). A pasted URL is reduced to its host; typing "*."
 * turns the switch on.
 */
export function SiteField({ full, busy, onAdd }: { full: boolean; busy: boolean; onAdd: (pattern: string) => void }) {
  const [host, setHost] = useState("");
  const [sub, setSub] = useState(false);

  const typed = host.trim();
  const pattern = typed ? normalizeSitePattern(`${sub ? "*." : ""}${typed}`) : null;
  const invalid = !!typed && !pattern;

  function change(v: string) {
    let next = v.replace(/^\s+/, "");
    if (next.startsWith("*.")) { setSub(true); next = next.slice(2); }
    setHost(next);
  }

  function paste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").trim();
    if (!/^[a-z]+:\/\//i.test(text)) return;
    e.preventDefault();
    try {
      change(new URL(text).host);
    } catch {
      change(text);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pattern || busy) return;
    onAdd(pattern);
    setHost("");
    setSub(false);
  }

  return (
    <form onSubmit={submit} className="mt-3 first:mt-0">
      <div className="flex gap-2">
        <div
          className={`flex h-9 min-w-0 flex-1 items-center rounded-lg border bg-[#fffdf8] font-mono text-[13px] transition-colors focus-within:border-accent ${
            invalid ? "border-[#c62828] focus-within:border-[#c62828]" : "hairline"
          }`}
        >
          <span className="hidden select-none pl-3 text-muted/70 sm:inline">https://</span>
          {sub && <span className="select-none text-accent">*.</span>}
          <input
            value={host}
            onChange={(e) => change(e.target.value)}
            onPaste={paste}
            placeholder="app.acme.com"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            inputMode="url"
            aria-label="Site"
            aria-invalid={invalid}
            disabled={full}
            className="h-full min-w-0 flex-1 bg-transparent pr-2 pl-3 text-ink outline-none placeholder:text-muted/50 sm:pl-0"
          />
          <button
            type="button"
            onClick={() => setSub((v) => !v)}
            aria-pressed={sub}
            disabled={full}
            className={`mr-1 inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[0.6875rem] transition-colors ${
              sub ? "bg-[rgba(221,105,54,.12)] text-accent" : "text-muted hover:text-ink"
            }`}
          >
            <span
              aria-hidden
              className={`grid h-3.5 w-3.5 place-items-center rounded-[4px] border ${
                sub ? "border-accent bg-accent text-cream" : "border-muted/50"
              }`}
            >
              {sub && (
                <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 12 5 5 9-10" />
                </svg>
              )}
            </span>
            Subdomains
          </button>
        </div>
        <button type="submit" disabled={!pattern || busy || full} className={buttonClass}>
          Add
        </button>
      </div>
      {invalid && <p className="mt-1.5 text-xs text-[#c62828]">Not a site</p>}
    </form>
  );
}
