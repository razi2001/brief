import Link from "next/link";
import ActivityTimeline from "@/components/ActivityTimeline";
import { requireUserId } from "@/lib/auth";
import { loadPerson } from "@/lib/activity-server";
import { OWNER_FIELDS } from "@/lib/admin-view";

export const metadata = { title: "What we see · Brief" };

// Plain words for each field of the owner's usage view (lib/admin-view
// OWNER_FIELDS). The test there keeps that list short; this page shows it.
const FIELD_WORDS: Record<(typeof OWNER_FIELDS)[number], string> = {
  id: "an id",
  kind: "ticket or draft",
  status: "filed, failed or in progress",
  createdAt: "when",
  deleted: "whether you deleted it",
  provider: "which tracker",
  userId: "your account id",
  personName: "your name",
  personEmail: "your email",
  personImage: "your photo",
  orgKey: "your workspace id",
  orgName: "your workspace name",
};

/**
 * The signed-in person's own page in the owner's activity view, drawn by the
 * same component from the same loader, so it can't say less than the owner
 * sees. Plus the fields of the usage view, from the list the code reads.
 */
export default async function WhatWeSeePage() {
  const userId = await requireUserId();
  const found = await loadPerson(userId);
  return (
    <div className="space-y-10">
      <section>
        <h1 className="page-title">What we see</h1>
        <p className="mt-2 max-w-[60ch] text-[13.5px] text-ink-2">
          Your account and the log below. Never the title, text, recording or link of a ticket.
        </p>
        <h2 className="mt-6 text-[13px] font-medium text-muted">Per ticket or draft</h2>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {OWNER_FIELDS.map((f) => (
            <li key={f} className="pill text-[12px]">
              {FIELD_WORDS[f]}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[13px]">
          <a href="https://github.com/razi2001/brief/blob/main/PRIVACY.md" className="text-muted hover:text-ink">
            Check it in the code
          </a>
          <span className="text-muted"> · </span>
          <Link href="/privacy" className="text-muted hover:text-ink">
            Privacy policy
          </Link>
        </p>
      </section>
      {found && (
        <ActivityTimeline
          person={found.person}
          items={found.items}
          now={found.now}
          back={{ href: "/connections", label: "Settings" }}
        />
      )}
    </div>
  );
}
