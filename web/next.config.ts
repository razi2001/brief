import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Fly Docker image
  // (.next/standalone/server.js + copied static/public).
  output: "standalone",
};

export default nextConfig;
