import type { Metadata } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import CloudBackground from "@/components/CloudBackground";
import ExtensionTokenSync from "@/components/ExtensionTokenSync";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Brief Cloud",
  description: "Talk through a bug. Brief Cloud writes the ticket and files it.",
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
          colorInputBackground: "#ffffff",
          colorInputText: "#1a1612",
          borderRadius: "10px",
          fontFamily: "var(--font-inter)",
        },
      }}
    >
      <html
        lang="en"
        className={`${inter.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col bg-cream text-ink">
          <CloudBackground />
          {/* Mirrors the web session onto the extension pairing (both ways:
              account switches re-pair it, signing out unpairs it). Mounted at
              the root so the signed-out case fires on any page. */}
          <ExtensionTokenSync />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
