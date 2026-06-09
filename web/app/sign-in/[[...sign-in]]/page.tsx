import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <SignIn />
    </main>
  );
}
