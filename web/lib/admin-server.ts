import { cache } from "react";
import { notFound } from "next/navigation";
import { clerkClient, currentUser } from "@clerk/nextjs/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { providerOf } from "@/lib/ticket-sync";
import { NO_ORG, isAdminEmail, kindOf, type AdminRow } from "@/lib/admin-view";

/**
 * The owner's monitoring view reads EVERY user's briefs - the one place in the
 * app not scoped by user_id or org. Every entry point goes through
 * requireAdmin(), which checks the signed-in Clerk user's own verified email
 * server-side; nothing the client sends can widen it.
 */
export const isAdmin = cache(async (): Promise<boolean> => {
  const user = await currentUser().catch(() => null);
  return isAdminEmail(user?.emailAddresses);
});

/** 404 for everyone else, so the page doesn't even admit it exists. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) notFound();
}

type Row = {
  id: string;
  user_id: string;
  status: string;
  title: string | null;
  created_at: string | null;
  archived_at: string | null;
  share_id: string | null;
  ticket_url: string | null;
  ticket_identifier: string | null;
  ticket_provider: string | null;
  ticket_title: string | null;
  ticket_state_name: string | null;
  ticket_state_color: string | null;
  filing_started_at: string | null;
};

// No ticket_body: it's the heavy column, and kindOf only needs it for a
// "processing" row with no filing claim - a few seconds' window in which such
// a row reads as a draft.
const COLUMNS =
  "id, user_id, status, title, created_at, archived_at, share_id, ticket_url, ticket_identifier, ticket_provider, ticket_title, ticket_state_name, ticket_state_color, filing_started_at";

const PAGE = 1000;

/** Every ticket and draft. Raw uploads that were never filed or drafted have no page to share. */
async function loadBriefs(): Promise<Row[]> {
  const admin = createAdminSupabase();
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("briefs")
      .select(COLUMNS)
      .neq("status", "uploaded")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) return out;
  }
}

async function loadOrgs(): Promise<Map<string, { key: string; name: string }>> {
  const { data } = await createAdminSupabase().from("org_members").select("user_id, org_key, org_name");
  return new Map(
    ((data ?? []) as { user_id: string; org_key: string; org_name: string }[]).map((m) => [
      m.user_id,
      { key: m.org_key, name: m.org_name },
    ]),
  );
}

type Person = { name: string; email: string | null; image: string | null };

/**
 * Batched Clerk lookups. Ids from the other Clerk instance (dev and prod share
 * one database) don't resolve and fall back to a short id.
 */
async function loadPeople(userIds: string[]): Promise<Map<string, Person>> {
  const people = new Map<string, Person>();
  const ids = [...new Set(userIds)];
  try {
    const client = await clerkClient();
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const list = await client.users.getUserList({ userId: chunk, limit: chunk.length });
      for (const u of list.data) {
        const email = u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? null;
        const name =
          [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || email?.split("@")[0] || "";
        people.set(u.id, { name, email, image: u.imageUrl || null });
      }
    }
  } catch {
    /* names are a nicety; the rows still list with their short ids */
  }
  return people;
}

export async function loadAdminRows(): Promise<AdminRow[]> {
  const [briefs, orgs] = await Promise.all([loadBriefs(), loadOrgs()]);
  const people = await loadPeople(briefs.map((b) => b.user_id));

  return briefs.map((b) => {
    const kind = kindOf(b);
    const person = people.get(b.user_id);
    const org = orgs.get(b.user_id);
    return {
      id: b.id,
      kind,
      status: b.status,
      title: b.ticket_title || b.title || (kind === "draft" ? "Untitled draft" : "Untitled ticket"),
      createdAt: b.created_at,
      deleted: !!b.archived_at,
      shareId: b.share_id,
      ticketUrl: b.ticket_url,
      ticketIdentifier: b.ticket_identifier,
      provider: b.ticket_url || b.ticket_provider ? providerOf(b.ticket_url, b.ticket_provider) : null,
      stateName: b.ticket_state_name,
      stateColor: b.ticket_state_color,
      userId: b.user_id,
      personName: person?.name || `User …${b.user_id.slice(-6)}`,
      personEmail: person?.email ?? null,
      personImage: person?.image ?? null,
      orgKey: org?.key ?? NO_ORG,
      orgName: org?.name ?? "No org",
    };
  });
}
