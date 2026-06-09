import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { requireUserId } from "@/lib/auth";

export default async function Dashboard() {
  await requireUserId();
  const user = await currentUser();
  return (
    <main style={{ maxWidth: 720, margin: "6vh auto", fontFamily: "system-ui" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>✦ Brief Cloud</h1>
        <UserButton />
      </header>
      <p>Signed in as {user?.primaryEmailAddress?.emailAddress ?? user?.id}</p>
    </main>
  );
}
