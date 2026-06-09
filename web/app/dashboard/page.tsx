import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { requireUserId } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import Link from "next/link";

export default async function Dashboard() {
  const userId = await requireUserId();
  const user = await currentUser();
  const hasLinear = !!user?.externalAccounts?.some((a) => (a.provider ?? "").toLowerCase().includes("linear"));

  const admin = createAdminSupabase();
  const { data: briefs } = await admin
    .from("briefs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <main style={{ maxWidth: 760, margin: "5vh auto", fontFamily: "system-ui", padding: "0 16px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>✦ Brief Cloud</h1>
        <UserButton />
      </header>
      <p style={{ color: "#666" }}>Signed in as {user?.primaryEmailAddress?.emailAddress ?? userId}</p>

      <section style={{ marginTop: 24 }}>
        <h2>Linear</h2>
        {hasLinear ? (
          <p>✅ Connected.</p>
        ) : (
          <p>
            Not connected.{" "}
            <Link href="/account">Connect Linear →</Link> (add it under Connected accounts)
          </p>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Recent briefs</h2>
        <ul style={{ lineHeight: 1.9 }}>
          {(briefs ?? []).map((b) => (
            <li key={b.id}>
              <code>{b.status}</code> · {b.source_kind ?? "?"} ·{" "}
              {b.ticket_url ? (
                <a href={b.ticket_url} target="_blank" rel="noreferrer">{b.ticket_identifier ?? "ticket"}</a>
              ) : (
                b.error ?? "—"
              )}
            </li>
          ))}
          {(!briefs || briefs.length === 0) && <li style={{ color: "#999" }}>No briefs yet.</li>}
        </ul>
      </section>
    </main>
  );
}
