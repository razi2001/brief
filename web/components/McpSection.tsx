import { LinearLogo, JiraLogo } from "./TrackerLogo";

/**
 * MCP (Model Context Protocol) section. Brief speaks MCP: a coding agent points
 * at the Linear or Jira MCP server and files your briefs straight into the
 * tracker. This mirrors the local-agent flow (the brief skill files "via an
 * integration/MCP"), so it's specifically about the Linear & Jira MCPs.
 */
export default function McpSection() {
  return (
    <section className="scroll-mt-8">
      <h2 className="text-xs uppercase tracking-[0.15em] text-muted">MCP</h2>
      <div className="card mt-3 px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border hairline bg-[#fffdf8]">
              <LinearLogo size={18} />
            </span>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border hairline bg-[#fffdf8]">
              <JiraLogo size={18} />
            </span>
          </span>
          <div className="min-w-0">
            <p className="text-sm text-ink">Linear &amp; Jira over MCP</p>
            <p className="mt-0.5 text-xs text-muted">
              Brief speaks the Model Context Protocol — point an MCP-capable agent
              (Claude, Cursor, Zed…) at the Linear or Jira MCP server and it files your
              briefs straight into the tracker.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
