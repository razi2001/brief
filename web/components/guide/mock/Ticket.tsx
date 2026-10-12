import { TrackerMark } from "./App";
import { IconCheck, IconChevron, IconExternal, IconMarkdown, IconSend, IconShare, IconSpark, IconX } from "./icons";

export const SAMPLE = {
  id: "ENG-142",
  title: "Pay fails silently at checkout",
  first: "Clicking Pay on checkout does nothing and the order is never placed.",
  rest: "There is no error, so the shopper thinks they paid.",
  improved: "Paying at checkout fails without a message: the order is not placed, and nothing tells the shopper.",
  steps: ["Open checkout with items in the cart", "Click Pay $48.00", "The button resets, and nothing else happens"],
  expected: "The order is placed, or the page says why it wasn't.",
};

export type Assistant =
  | "pill"
  | { chip?: string; ask?: string; done?: boolean; undone?: boolean; undoOn?: boolean; quote?: boolean };

/**
 * A ticket inside Brief Cloud (BriefView + TicketDoc): the breadcrumb, the
 * sheet with its meta line, title and toolbar, the body you edit in place,
 * the selection toolbar, and the assistant (TicketChat) floating bottom right.
 */
export function MockTicket({
  select,
  bubble,
  bold,
  improved,
  saved,
  repro = true,
  caret,
  assistant,
}: {
  /** The summary's first sentence is selected. */
  select?: boolean;
  bubble?: "idle" | "B" | "Improve" | "Ask AI";
  bold?: boolean;
  improved?: boolean;
  saved?: boolean;
  repro?: boolean;
  caret?: boolean;
  assistant?: Assistant;
}) {
  const chev = (
    <span className="gd-fill" style={{ display: "inline-block", width: "calc(12 * var(--a))", height: "calc(12 * var(--a))" }}>
      <IconChevron />
    </span>
  );
  const a = typeof assistant === "object" ? assistant : null;
  return (
    <>
      <div className="gd-crumbs">
        Tickets {chev} <span className="mono">{SAMPLE.id}</span> {chev} <b>{SAMPLE.title}</b>
      </div>
      <div className="gd-card gd-sheet">
        <div className="gd-meta">
          <i style={{ background: "#e2e2e2", border: "calc(1 * var(--a)) solid #b8b8b8" }} />
          Todo
          <span className="sep" />
          <span className="mono">{SAMPLE.id}</span>
          <span className="sep" />
          <span className="muted">Oct 12, 2026</span>
        </div>
        <div className="gd-ttl">{SAMPLE.title}</div>
        <div className="gd-tbar">
          <span className="open">
            <TrackerMark kind="linear" />
            Open in Linear
            <IconExternal />
          </span>
          <span className="vs" />
          <span style={{ display: "inline-flex", alignItems: "center", gap: "calc(6 * var(--a))" }}>
            <span className="gd-fill" style={{ display: "inline-block", width: "calc(13 * var(--a))", height: "calc(13 * var(--a))" }}>
              <IconShare />
            </span>
            Share
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "calc(6 * var(--a))" }}>
            <span className="gd-fill" style={{ display: "inline-block", width: "calc(13 * var(--a))", height: "calc(13 * var(--a))" }}>
              <IconMarkdown />
            </span>
            Markdown
          </span>
          {saved && <span className="saved gd-in">Saved</span>}
        </div>
        <div className="gd-body2">
          <p style={{ position: "relative" }}>
            {improved ? (
              <span key="imp" data-gd="improved" className="gd-flash">
                {SAMPLE.improved}
              </span>
            ) : (
              <>
                <span data-gd="first" className={select ? "sel" : ""}>{bold ? <b>{SAMPLE.first}</b> : SAMPLE.first}</span>
                {caret && <span className="gd-caret" />} {SAMPLE.rest}
              </>
            )}
            {bubble && !improved && (
              <span className="gd-bub" style={{ left: "calc(-4 * var(--a))", top: "calc(-44 * var(--a))" }}>
                <span style={{ fontWeight: 700 }}>H</span>
                <span className="vl" />
                <span data-gd="bub-b" className={bubble === "B" ? "on" : ""} style={{ fontWeight: 700 }}>
                  B
                </span>
                <span style={{ fontStyle: "italic" }}>I</span>
                <span className="gd-mono">{"</>"}</span>
                <span className="vl" />
                <span data-gd="bub-improve" className={bubble === "Improve" ? "on" : ""}>
                  <span className="sp gd-fill" style={{ display: "inline-block" }}>
                    <IconSpark />
                  </span>
                  Improve
                </span>
                <span>Shorten</span>
                <span data-gd="bub-ask" className={bubble === "Ask AI" ? "on" : ""}>Ask AI</span>
              </span>
            )}
          </p>
          {repro && (
            <div key={a?.done && !a.undone ? "added" : "base"} className={a?.done && !a.undone ? "gd-flash" : ""}>
              <h4>Steps to reproduce</h4>
              <ol>
                {SAMPLE.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          )}
          <h4>Expected</h4>
          <p>{SAMPLE.expected}</p>
        </div>
      </div>

      {assistant === "pill" && (
        <span data-gd="ai-pill" className="gd-aipill gd-pop">
          <IconSpark />
          Assistant
          <kbd>Ctrl K</kbd>
        </span>
      )}
      {a && (
        <div className="gd-ai">
          <div className="h">
            <span>
              <IconSpark />
              Assistant
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "calc(8 * var(--a))" }}>
              {a.ask && <span className="x">Clear</span>}
              <span className="gd-fill" style={{ display: "inline-block", width: "calc(14 * var(--a))", height: "calc(14 * var(--a))", color: "#8a8378" }}>
                <IconX />
              </span>
            </span>
          </div>
          {a.ask && (
            <div className="thread">
              <div className="you gd-pop">{a.ask}</div>
              <div className="res">
                <span className="sp gd-fill" style={{ display: "inline-block" }}>
                  <IconSpark />
                </span>
                {a.done ? (
                  a.undone ? (
                    <span style={{ color: "#8a8378" }}>Reverted</span>
                  ) : (
                    <>
                      <span className="ck gd-fill" style={{ display: "inline-block" }}>
                        <IconCheck />
                      </span>
                      Added Steps to reproduce
                      <span data-gd="undo" className={`undo${a.undoOn ? " on" : ""}`}>Undo</span>
                    </>
                  )
                ) : (
                  <span className="gd-type">Editing the ticket…</span>
                )}
              </div>
            </div>
          )}
          {!a.ask && (
            <div className="chips" style={{ borderTop: 0 }}>
              {["Add repro steps", "Expected vs actual", "Acceptance criteria", "Improve layout"].map((c) => (
                <span key={c} data-gd={`chip-${c.split(" ")[1] ?? c}`} className={a.chip === c ? "on" : ""}>
                  {c}
                </span>
              ))}
            </div>
          )}
          {a.quote && (
            <div style={{ margin: "calc(10 * var(--a)) calc(14 * var(--a)) 0", padding: "calc(6 * var(--a)) calc(10 * var(--a))", borderRadius: "calc(8 * var(--a))", background: "#f7f4ee", fontSize: "calc(11.5 * var(--a))", fontStyle: "italic", color: "#3a3530" }}>
              <span style={{ borderLeft: "calc(2 * var(--a)) solid rgba(221,105,54,.5)", paddingLeft: "calc(8 * var(--a))", display: "block" }}>{SAMPLE.first}</span>
            </div>
          )}
          <div className="comp">
            <span className="q">Ask AI to edit the ticket…</span>
            <span className="send">
              <IconSend />
            </span>
          </div>
        </div>
      )}
    </>
  );
}
