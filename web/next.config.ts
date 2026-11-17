import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Fly Docker image
  // (.next/standalone/server.js + copied static/public).
  output: "standalone",
  experimental: {
    // Keep pages you just visited in the client router for 30s, so going back
    // to one shows it at once instead of fetching it again (Next's default is
    // 0 for dynamic pages). Live views still poll and refresh on their own.
    staleTimes: { dynamic: 30 },
  },
  // Bug bash became Quality competition: invite links already sent keep working.
  async redirects() {
    return [
      { source: "/bash", destination: "/competition", permanent: true },
      { source: "/bash/:path*", destination: "/competition/:path*", permanent: true },
      { source: "/guide/bug-bash", destination: "/guide/quality-competition", permanent: true },
    ];
  },
};

export default nextConfig;
