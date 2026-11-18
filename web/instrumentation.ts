// Runs once when the server starts (Next's instrumentation hook).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` and `next dev` start this too; only a running production server pings.
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startTelemetry } = await import("@/lib/telemetry-server");
  startTelemetry();
}
