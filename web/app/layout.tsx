import type { Metadata } from "next";
import { Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import CloudBackground from "@/components/CloudBackground";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Brief",
  description: "Talk through a bug. Your agent writes the ticket.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#dd6936",
          colorBackground: "#f5f1e8",
          colorText: "#1a1612",
          colorInputBackground: "#fffdf8",
          colorInputText: "#1a1612",
          borderRadius: "10px",
          fontFamily: "var(--font-mono)",
        },
      }}
    >
      <html
        lang="en"
        className={`${instrumentSerif.variable} ${jetbrainsMono.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col bg-cream text-ink">
          <CloudBackground />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
