/**
 * MCP (Model Context Protocol) connection card. Brief's briefs are reachable
 * programmatically today (the extension files through a bearer-token API); the
 * MCP server that lets any MCP-capable agent read and file them directly is on
 * the way. Honest, static, no fabricated endpoint.
 */
export default function McpSection() {
  return (
    <section className="scroll-mt-8">
      <h2 className="text-xs uppercase tracking-[0.15em] text-muted">MCP</h2>
      <div className="card mt-3 px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border hairline bg-[#fffdf8] font-mono text-[0.6875rem] text-accent">
              MCP
            </span>
            <div className="min-w-0">
              <p className="text-sm text-ink">Connect via MCP</p>
              <p className="mt-0.5 text-xs text-muted">
                Point any MCP-capable agent (Claude, Cursor, Zed…) at Brief to read and
                file your briefs directly.
              </p>
            </div>
          </div>
          <span className="pill shrink-0 border-hairline bg-cream-2 text-muted">
            Coming soon
          </span>
        </div>
      </div>
    </section>
  );
}
