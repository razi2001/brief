import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy · Brief Cloud",
  description:
    "What the Brief Cloud Chrome extension and web app collect, why, where it goes, and how long it is kept.",
};

// Public, static privacy policy for the Brief Cloud Chrome Web Store listing.
// Reachable at https://cloud.get-brief.app/privacy (allowlisted in proxy.ts).
// Keep this in sync with the Chrome Web Store "Privacy practices" disclosures.

const LAST_UPDATED = "June 14, 2026";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2
        className="text-2xl text-ink"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-2">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <header className="border-b border-hairline pb-8">
        <p className="text-xs uppercase tracking-[0.18em] text-accent">
          Brief Cloud
        </p>
        <h1
          className="mt-2 text-4xl text-ink"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Privacy Policy
        </h1>
        <p className="mt-3 text-sm text-muted">Last updated: {LAST_UPDATED}</p>
      </header>

      <div className="mt-8 space-y-3 text-sm leading-relaxed text-ink-2">
        <p>
          Brief Cloud is a Chrome extension and companion web app that lets you
          record a bug or feature request, then writes a clear ticket from that
          recording and files it to your connected issue tracker (Linear or
          Jira). This policy explains exactly what we collect, why, where it
          goes, and how long we keep it. We wrote it to be readable, not to hide
          behind it.
        </p>
        <p>
          Short version: we only handle the briefs you choose to record, we send
          them to our own backend so we can turn them into tickets, we do not
          run any advertising or analytics trackers, and we never sell your
          data.
        </p>
      </div>

      <Section title="What we collect, and only when you record a brief">
        <p>
          The extension does nothing in the background. It captures data only
          while you actively record a brief or take a screenshot. For a brief
          you record, that can include:
        </p>
        <ul className="ml-5 list-disc space-y-2">
          <li>
            <strong>Screen and voice recording.</strong> A recording of the
            browser tab you are on, mixed with your microphone narration, so we
            can see and hear the issue you are describing.
          </li>
          <li>
            <strong>Microphone audio.</strong> A short audio track of your
            narration, used only to transcribe what you said into ticket text.
          </li>
          <li>
            <strong>Screenshots and keyframes.</strong> A screenshot you choose
            to capture (with any annotations you draw on it), plus periodic still
            frames sampled from the recording so the ticket can show what was on
            screen.
          </li>
          <li>
            <strong>Diagnostic events from the recorded tab.</strong> Console
            errors, uncaught JavaScript errors, and failed network requests
            (method, the request URL, and the HTTP status) that occurred during
            the recording. We capture error messages and request URLs and status
            codes only. We do not capture the page DOM, request or response
            bodies, or cookies.
          </li>
          <li>
            <strong>Reproduction steps.</strong> A timeline of your clicks,
            scrolls, and key presses during the recording, so the ticket can
            describe how to reproduce the issue. Typed characters are masked
            (recorded as a placeholder, not the actual keystrokes).
          </li>
          <li>
            <strong>Page context.</strong> The URL and title of the tab you
            recorded, so the ticket records where the issue happened.
          </li>
          <li>
            <strong>What you type.</strong> The brief name, your written
            description, and any custom key and value fields you add.
          </li>
          <li>
            <strong>Environment.</strong> Your browser user agent string
            (browser and operating system), included as context on the ticket.
          </li>
        </ul>
      </Section>

      <Section title="Account and authentication data">
        <p>
          Sign in is handled by our authentication provider, Clerk. When you
          connect the extension to your account, the web app issues a pairing
          token that the extension stores locally in the browser and sends back
          to our backend to prove the brief is yours. The token is stored only on
          your device and is cleared when you sign out or disconnect. It is never
          shared with any third party.
        </p>
      </Section>

      <Section title="How we use it">
        <p>
          We use the data above for one purpose: to generate a well written
          ticket from your recording and file it to the tracker you connected.
          The recording, screenshots, transcript, diagnostics, and the text you
          wrote become the ticket. If you enable the &quot;attach the
          recording&quot; option, the recording is attached to the filed ticket;
          otherwise it is used only to write the ticket and is not attached.
        </p>
        <p>
          We do not use your briefs to build advertising profiles, and we do not
          use them to train third party models for unrelated purposes.
        </p>
      </Section>

      <Section title="Where it goes (third parties)">
        <p>Your brief data is sent to the following services, and no others:</p>
        <ul className="ml-5 list-disc space-y-2">
          <li>
            <strong>Brief Cloud backend</strong> (cloud.get-brief.app), hosted on
            Fly.io, which receives the brief and orchestrates writing and filing
            the ticket.
          </li>
          <li>
            <strong>Supabase Storage</strong>, where the recording, audio,
            screenshots, and keyframes are uploaded (via short lived signed upload
            URLs) until the ticket is filed.
          </li>
          <li>
            <strong>OpenAI</strong>, used by our backend to transcribe your
            narration audio into text. Only the audio needed for transcription is
            sent.
          </li>
          <li>
            <strong>Clerk</strong>, our authentication provider, which handles
            sign in and your account profile.
          </li>
          <li>
            <strong>Your connected tracker</strong> (Linear or Jira), where the
            finished ticket is created on your behalf using the connection you
            authorized.
          </li>
        </ul>
      </Section>

      <Section title="How long we keep it">
        <p>
          Brief media (recording, audio, screenshots, keyframes) is uploaded to
          storage so the ticket can be written. Once the brief has been filed,
          the audio track and the sampled keyframes are removed. The screenshot
          is kept, and the recording is kept only when you chose the &quot;attach
          the recording&quot; option, so the brief&apos;s own page can show the
          same evidence; everything else is deleted. A record of the ticket you
          filed (its title, status, the written-up text, and the link to it in
          your tracker) is kept in your account so your Brief Cloud feed and the
          brief&apos;s page can show it.
        </p>
        <p className="mt-3">
          Every filed brief gets a private page at an unguessable web address
          (and that address is never indexed by search engines). Anyone with the
          link can view the ticket and its kept evidence, so only share it with
          people you trust. You can delete or archive briefs from the web app.
        </p>
      </Section>

      <Section title="What we do not do">
        <ul className="ml-5 list-disc space-y-2">
          <li>No advertising, ad networks, or affiliate injection.</li>
          <li>
            No analytics or telemetry SDKs in the extension (no Google Analytics,
            Segment, Mixpanel, Sentry, or similar).
          </li>
          <li>No selling or renting of your data to anyone.</li>
          <li>
            No reading of pages you have not chosen to record. The extension is
            inert until you start a recording or take a screenshot.
          </li>
          <li>No access to your cookies, passwords, or browsing history.</li>
        </ul>
      </Section>

      <Section title="Why the extension asks for the permissions it does">
        <p>
          Each Chrome permission maps directly to a capture feature: tab capture
          to record the current tab, the active tab and host access to take a
          screenshot and inject the recorder onto the page you are on, scripting
          to capture console and network errors during the recording, an
          offscreen document to run the recorder, and local storage to keep your
          brief inbox and pairing token on your device. The extension talks only
          to the Brief Cloud web app for pairing.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          Recording is always something you start. You choose whether to attach
          the recording to the ticket, what to type, and which tracker to
          connect. You can disconnect the extension or sign out at any time,
          which clears the pairing token from your device. To request deletion of
          account data, contact us at the address below.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about this policy or your data? Email{" "}
          <a className="text-accent underline" href="mailto:privacy@get-brief.app">
            privacy@get-brief.app
          </a>
          .
        </p>
      </Section>

      <footer className="mt-14 border-t border-hairline pt-6 text-xs text-muted">
        <Link href="/" className="text-accent underline">
          Back to Brief Cloud
        </Link>
      </footer>
    </main>
  );
}
