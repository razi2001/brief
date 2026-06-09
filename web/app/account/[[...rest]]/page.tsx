import { UserProfile } from "@clerk/nextjs";

export default function Account() {
  return (
    <main style={{ display: "grid", placeItems: "center", padding: "4vh 0" }}>
      <UserProfile />
    </main>
  );
}
