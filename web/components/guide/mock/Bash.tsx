import type { CSSProperties, ReactNode } from "react";
import { IconCheck, IconPlus } from "./icons";

/** A length in the app's scale (see guide.css --a). */
const a = (n: number) => `calc(${n} * var(--a))`;

const INK = "#1a1612";
const MUTED = "#8a8378";
const ACCENT = "#dd6936";
const LINE = "rgba(26, 22, 18, 0.09)";

const btn = (accent: boolean, on?: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: a(5),
  height: a(28),
  padding: `0 ${a(11)}`,
  borderRadius: a(8),
  fontSize: a(12),
  fontWeight: 500,
  whiteSpace: "nowrap",
  background: accent ? (on ? "#c95e2c" : ACCENT) : on ? "rgba(26,22,18,.08)" : "#fffdfa",
  color: accent ? "#fff" : INK,
  border: accent ? "none" : `${a(1)} solid ${LINE}`,
});

function Plus() {
  return (
    <span style={{ display: "grid", width: a(12), height: a(12) }}>
      <IconPlus />
    </span>
  );
}

function Sparkle() {
  return (
    <svg viewBox="0 0 16 16" width="100%" height="100%" fill={ACCENT} aria-hidden="true" style={{ width: a(12), height: a(12) }}>
      <path d="M8 1.5c.4 2.9 1.7 4.2 4.6 4.6-2.9.4-4.2 1.7-4.6 4.6-.4-2.9-1.7-4.2-4.6-4.6 2.9-.4 4.2-1.7 4.6-4.6Z" />
    </svg>
  );
}

function Header({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: a(10) }}>
      <div className="gd-h1">{title}</div>
      <div style={{ display: "flex", gap: a(6) }}>{children}</div>
    </div>
  );
}

export type BashListS = { newOn?: boolean; suggestOn?: boolean; rows?: Array<{ name: string; meta: string; state: string; fresh?: boolean }> };

/** Bug bash (BashHome): the tabs, a line per bug bash, Suggested and New bug bash at the top. */
export function MockBashList({ s }: { s: BashListS }) {
  const rows = s.rows ?? [];
  return (
    <div>
      <Header title="Bug bash">
        <span data-gd="bash-suggested" style={btn(false, s.suggestOn)}>
          <Sparkle />
          Suggested <span style={{ color: MUTED }}>2</span>
        </span>
        <span data-gd="bash-new" style={btn(true, s.newOn)}>
          <Plus />
          New bug bash
        </span>
      </Header>
      {s.suggestOn && (
        <div className="gd-card gd-pop" style={{ position: "absolute", right: a(32), top: a(76), width: a(220), padding: a(4), zIndex: 3 }}>
          {[
            ["Checkout", "6 bugs · 4 open"],
            ["Search", "4 bugs · 2 open"],
          ].map(([n, m], i) => (
            <div key={n} style={{ display: "flex", alignItems: "center", padding: `${a(6)} ${a(8)}`, borderRadius: a(6), background: i === 0 ? "rgba(26,22,18,.05)" : undefined }}>
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: a(12), fontWeight: 500 }}>{n}</span>
                <span style={{ display: "block", fontSize: a(10.5), color: MUTED }}>{m}</span>
              </span>
              <span style={{ fontSize: a(11), color: i === 0 ? "#fff" : MUTED, background: i === 0 ? ACCENT : undefined, padding: `${a(3)} ${a(6)}`, borderRadius: a(5) }}>Create</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: a(4), marginTop: a(14), fontSize: a(12) }}>
        {["Assigned to me", "All", "Closed"].map((t, i) => (
          <span key={t} style={{ padding: `${a(4)} ${a(9)}`, borderRadius: a(7), background: i === 1 ? "rgba(26,22,18,.08)" : undefined, color: i === 1 ? INK : MUTED, fontWeight: i === 1 ? 500 : 400 }}>
            {t} <span style={{ color: MUTED }}>{i === 1 ? rows.length : 0}</span>
          </span>
        ))}
      </div>
      <div style={{ marginTop: a(12) }}>
        {rows.length === 0 ? (
          <div style={{ border: `${a(1)} dashed rgba(26,22,18,.16)`, borderRadius: a(12), padding: `${a(34)} 0`, textAlign: "center", fontSize: a(12.5), fontWeight: 500 }}>No bug bash running</div>
        ) : (
          rows.map((r) => (
            <div key={r.name} className={r.fresh ? "gd-pop" : ""} style={{ display: "flex", alignItems: "center", gap: a(10), padding: `${a(9)} ${a(10)}`, borderRadius: a(8), background: r.fresh ? "rgba(221,105,54,.06)" : undefined }}>
              <span style={{ width: a(12), height: a(12), borderRadius: "50%", border: `${a(1.5)} solid ${ACCENT}`, background: `linear-gradient(90deg, transparent 50%, ${ACCENT} 50%)` }} />
              <span style={{ fontSize: a(12.5) }}>{r.name}</span>
              <span style={{ fontSize: a(11), color: MUTED }}>{r.meta}</span>
              <span style={{ marginLeft: "auto", fontSize: a(11), color: MUTED }}>{r.state}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export type BashNewS = { name?: string; typing?: boolean; hold?: boolean; holdOn?: boolean; createOn?: boolean };

/** New bug bash (BashNew): a name, the dates, the time each person gets, and Review before filing. */
export function MockBashNew({ s }: { s: BashNewS }) {
  const field = (label: string, value: ReactNode, gd?: string, on?: boolean) => (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: a(11), color: MUTED, marginBottom: a(5) }}>{label}</div>
      <div
        data-gd={gd}
        style={{ height: a(30), display: "flex", alignItems: "center", padding: `0 ${a(10)}`, borderRadius: a(8), border: `${a(1)} solid ${on ? ACCENT : LINE}`, background: "#fffdfa", fontSize: a(12.5) }}
      >
        {value}
      </div>
    </div>
  );
  return (
    <div style={{ maxWidth: a(420) }}>
      <div style={{ fontSize: a(11), color: MUTED, marginBottom: a(6) }}>Bug bash › New</div>
      <div className="gd-h1">New bug bash</div>
      <div style={{ display: "flex", flexDirection: "column", gap: a(12), marginTop: a(16) }}>
        {field("Name", s.name ? <span className={s.typing ? "gd-type gd-caret" : ""}>{s.name}</span> : <span style={{ color: MUTED }}>Release 2.4</span>, "bash-name", s.typing)}
        <div style={{ display: "flex", gap: a(10) }}>
          {field("From", "15 Nov")}
          {field("To", "18 Nov")}
          {field("Each person gets", "30 min")}
        </div>
        <div data-gd="bash-hold" style={{ display: "flex", alignItems: "center", gap: a(10), padding: `${a(9)} ${a(11)}`, borderRadius: a(10), border: `${a(1)} solid ${s.holdOn ? ACCENT : LINE}`, background: "#fffdfa" }}>
          <span style={{ flex: 1, fontSize: a(12.5), fontWeight: 500 }}>Review before filing</span>
          <span style={{ width: a(28), height: a(16), borderRadius: a(16), background: s.hold ? ACCENT : "rgba(26,22,18,.16)", position: "relative", transition: "background .2s" }}>
            <span style={{ position: "absolute", top: a(2), left: s.hold ? a(14) : a(2), width: a(12), height: a(12), borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
          </span>
        </div>
        <div style={{ display: "flex", gap: a(6), justifyContent: "flex-end" }}>
          <span style={btn(false)}>Cancel</span>
          <span data-gd="bash-create" style={btn(true, s.createOn)}>
            Create
          </span>
        </div>
      </div>
    </div>
  );
}

export type BashPageS = {
  copied?: boolean;
  copyOn?: boolean;
  /** Before you start: Join, then Start. */
  me?: "join" | "start" | "testing";
  meOn?: boolean;
  left?: string;
  /** How much of your time is left, 0 to 1. */
  ring?: number;
  board?: Array<{ name: string; n: number; you?: boolean }>;
  found?: number;
  review?: boolean;
  fileOn?: boolean;
  filed?: boolean;
};

const HAT = ["#f2c94c", "#c9ced6", "#d99a6c"];

/** A bug bash's page (BashView): your clock, the board, and once it is over the review (BashReview). */
export function MockBashPage({ s }: { s: BashPageS }) {
  const board = s.board ?? [];
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <div>
      <div style={{ fontSize: a(11), color: MUTED, marginBottom: a(6) }}>Bug bash › Checkout</div>
      <Header title="Checkout">
        <span data-gd="bash-copy" style={btn(false, s.copyOn)}>
          {s.copied ? "Copied" : "Copy invite link"}
        </span>
        {s.me === "join" && (
          <span data-gd="bash-join" style={btn(true, s.meOn)}>
            Join
          </span>
        )}
      </Header>
      <div style={{ fontSize: a(11.5), color: MUTED, marginTop: a(4) }}>15 Nov to 18 Nov · 30 min each{s.review ? " · Closed" : ""}</div>

      {!s.review ? (
        <div style={{ display: "flex", gap: a(12), marginTop: a(16) }}>
          <div className="gd-card" style={{ flex: "0 0 auto", width: a(150), padding: a(12), display: "flex", flexDirection: "column", alignItems: "center", gap: a(6) }}>
            {s.me === "testing" ? (
              <>
                <svg viewBox="0 0 36 36" style={{ width: a(54), height: a(54) }} aria-hidden="true">
                  <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(26,22,18,.08)" strokeWidth="3" />
                  <circle cx="18" cy="18" r={r} fill="none" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - (s.ring ?? 1))} transform="rotate(-90 18 18)" style={{ transition: "stroke-dashoffset 1s linear" }} />
                </svg>
                <span style={{ fontSize: a(13), fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{s.left}</span>
                <span style={{ fontSize: a(10.5), color: MUTED }}>Your time</span>
              </>
            ) : (
              <span data-gd="bash-start" style={{ ...btn(true, s.meOn), height: a(40), opacity: s.me === "join" ? 0.45 : 1 }}>
                Start my 30 min
              </span>
            )}
          </div>
          <div className="gd-card" style={{ flex: 1, padding: a(12) }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: a(11), color: MUTED, marginBottom: a(6) }}>
              <span>Podium</span>
              <span>
                <b style={{ color: INK }}>{s.found ?? 0}</b> bugs found
              </span>
            </div>
            {board.length === 0 ? (
              <div style={{ fontSize: a(11.5), color: MUTED, padding: `${a(10)} 0` }}>Nobody has joined yet</div>
            ) : (
              board.map((p, i) => (
                <div key={p.name} style={{ display: "flex", alignItems: "center", gap: a(8), padding: `${a(4)} ${a(6)}`, borderRadius: a(7), background: p.you ? "rgba(221,105,54,.07)" : undefined }}>
                  <span style={{ width: a(14), fontSize: a(10.5), color: MUTED, textAlign: "center" }}>{i + 1}</span>
                  <span className="gd-av" style={{ boxShadow: i < 3 && p.n > 0 ? `0 0 0 ${a(2)} ${HAT[i]}` : undefined }}>
                    {p.name[0]}
                  </span>
                  <span style={{ flex: 1, fontSize: a(12) }}>
                    {p.name}
                    {p.you && <span style={{ color: ACCENT, fontSize: a(10.5), marginLeft: a(4) }}>you</span>}
                  </span>
                  <span style={{ width: a(60), height: a(5), borderRadius: a(5), background: "rgba(26,22,18,.07)", overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${Math.max(p.n ? 10 : 0, (p.n / Math.max(1, ...board.map((b) => b.n))) * 100)}%`, background: p.you ? ACCENT : "rgba(26,22,18,.25)", transition: "width .6s" }} />
                  </span>
                  <span style={{ width: a(16), textAlign: "right", fontSize: a(12.5), fontWeight: 600 }}>{p.n}</span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: a(14) }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: a(8) }}>
            <span style={{ fontSize: a(13), fontWeight: 600 }}>Review</span>
            <span data-gd="bash-file" style={btn(true, s.fileOn)}>
              {s.filed ? (
                <>
                  <span style={{ display: "grid", width: a(12), height: a(12) }}>
                    <IconCheck />
                  </span>
                  Filed
                </>
              ) : (
                "Create 2 tickets"
              )}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: a(10) }}>
            {[
              { t: "Pay does nothing", n: ["Sam: Pay button dead", "Ana: Nothing on Pay", "Lee: Can't pay"] },
              { t: "Coupon accepts expired codes", n: ["Ana: Old coupon worked", "Sam: EXPIRED10 applies"] },
            ].map((g) => (
              <div key={g.t} className="gd-card" style={{ padding: a(10) }}>
                <div style={{ display: "flex", alignItems: "center", gap: a(6), fontSize: a(12), fontWeight: 600 }}>
                  {g.t}
                  {s.filed && <span style={{ marginLeft: "auto", fontSize: a(10.5), color: "#2e7d32", fontWeight: 500 }}>Ticket</span>}
                </div>
                {g.n.map((x) => (
                  <div key={x} style={{ marginTop: a(6), padding: `${a(5)} ${a(7)}`, borderRadius: a(6), border: `${a(1)} solid ${LINE}`, fontSize: a(10.5), color: "#3a3530" }}>
                    {x}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
