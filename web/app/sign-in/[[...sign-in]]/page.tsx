import { SignIn } from "@clerk/nextjs";
import BrandMark from "@/components/BrandMark";

export default function Page() {
  return (
    <main className="min-h-screen text-ink flex flex-col items-center justify-center px-4 py-16">
      <div className="flex flex-col items-center text-center">
        <BrandMark size={56} />
        <h1 className="font-display mt-6 text-5xl sm:text-6xl leading-tight text-ink">
          what&apos;s the <em className="italic text-accent">brief</em>?
        </h1>
        <p className="mt-3 text-sm tracking-wide text-muted max-w-md">
          Talk through a bug. Your agent writes the ticket.
        </p>
      </div>
      <div className="mt-10">
        <SignIn />
      </div>
    </main>
  );
}
