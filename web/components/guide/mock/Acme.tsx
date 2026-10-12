import type { ReactNode } from "react";

export type AcmePage = "checkout" | "pricing" | "search" | "profile";

const NAV: Array<[string, AcmePage | null]> = [
  ["Shop", null],
  ["Pricing", "pricing"],
  ["Orders", "search"],
  ["Profile", "profile"],
  ["Checkout", "checkout"],
];

/**
 * A small shop ("your app" in the illustrations), one page at a time, with the state each
 * scene needs: paying, searching, an edited name, a drawing over the price.
 */
export function MockAcme({
  page,
  paying,
  searching,
  query,
  edited,
  children,
}: {
  page: AcmePage;
  paying?: boolean;
  searching?: boolean;
  query?: string;
  edited?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="gd-acme">
      <div className="ah">
        <span className="logo">
          <i>A</i>acme
        </span>
        {NAV.map(([label, p]) => (
          <span key={label} className={p === page ? "cur" : ""}>
            {label}
          </span>
        ))}
      </div>
      <div className="am">
        {page === "checkout" && (
          <>
            <h3>Checkout</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "calc(12 * var(--u))" }}>
              <div className="card">
                <div className="row">
                  <span>Stoneware mug, sand</span>
                  <span>$18.00</span>
                </div>
                <div className="row">
                  <span>Linen notebook ×2</span>
                  <span>$24.00</span>
                </div>
                <div className="row muted">
                  <span>Shipping</span>
                  <span>$6.00</span>
                </div>
                <div className="row" style={{ fontWeight: 700 }}>
                  <span>Total</span>
                  <span>$48.00</span>
                </div>
              </div>
              <div className="card">
                <div style={{ fontWeight: 700, fontSize: "calc(10 * var(--u))", marginBottom: "calc(8 * var(--u))" }}>Payment</div>
                <div className="row" style={{ border: "calc(1 * var(--u)) solid #c9d6f5", borderRadius: "calc(6 * var(--u))", padding: "calc(6 * var(--u)) calc(8 * var(--u))", background: "#f7f9ff" }}>
                  <span>Acme Wallet</span>
                  <span className="pill">Selected</span>
                </div>
                <div data-gd="pay" className="btn" style={{ marginTop: "calc(10 * var(--u))", opacity: paying ? 0.7 : 1 }}>
                  {paying ? "Processing..." : "Pay $48.00"}
                </div>
              </div>
            </div>
          </>
        )}

        {page === "pricing" && (
          <>
            <h3>Pricing</h3>
            <div style={{ display: "flex", gap: "calc(12 * var(--u))" }}>
              {[
                { n: "Starter", p: "$9", per: "/mo" },
                { n: "Team", p: "$1,249.00", per: "/mo", pop: true },
                { n: "Business", p: "Custom", per: "" },
              ].map((x) => (
                <div key={x.n} className={`plan${x.pop ? " pop" : ""}`}>
                  <div style={{ fontWeight: 600, fontSize: "calc(10 * var(--u))", marginBottom: "calc(6 * var(--u))" }}>{x.n}</div>
                  <div className="price">
                    {x.p}
                    {x.per && <small>{x.per}</small>}
                  </div>
                  <div className="muted" style={{ fontSize: "calc(8 * var(--u))", margin: "calc(8 * var(--u)) 0 calc(10 * var(--u))" }}>
                    Unlimited orders
                    <br />
                    Priority support
                  </div>
                  <div className={`btn${x.pop ? "" : " ghost"}`}>Choose plan</div>
                </div>
              ))}
            </div>
          </>
        )}

        {page === "search" && (
          <>
            <h3>Orders</h3>
            <div className="card" style={{ display: "flex", gap: "calc(8 * var(--u))" }}>
              <div className="input" style={{ flex: 1 }}>
                {query ? <span>{query}</span> : <span className="muted">Order number or name</span>}
              </div>
              <div data-gd="search-btn" className="btn">Search</div>
            </div>
            <div className="card" style={{ marginTop: "calc(10 * var(--u))", minHeight: "calc(110 * var(--u))" }}>
              {searching ? (
                <div style={{ display: "flex", alignItems: "center", gap: "calc(10 * var(--u))", padding: "calc(10 * var(--u)) 0" }}>
                  <span className="gd-spinner" />
                  <span className="muted" style={{ fontSize: "calc(9 * var(--u))" }}>Searching orders...</span>
                </div>
              ) : (
                ["#1048 Maya Chen", "#1047 Leo Martin", "#1046 Ada Okafor", "#1045 Tom Becker"].map((r) => (
                  <div key={r} className="row">
                    <span>{r}</span>
                    <span className="pill">Shipped</span>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {page === "profile" && (
          <>
            <h3>Your profile</h3>
            <div className="card" style={{ width: "62%" }}>
              <div style={{ fontSize: "calc(8.5 * var(--u))", fontWeight: 600, marginBottom: "calc(4 * var(--u))" }}>Name</div>
              <div className="input">{edited ? "Sam R." : "Sam Rivera"}</div>
              <div style={{ fontSize: "calc(8.5 * var(--u))", fontWeight: 600, margin: "calc(8 * var(--u)) 0 calc(4 * var(--u))" }}>Shop name</div>
              <div className="input">Rivera Ceramics</div>
              <div style={{ display: "flex", alignItems: "center", gap: "calc(8 * var(--u))", marginTop: "calc(12 * var(--u))" }}>
                <div data-gd="save" className="btn">Save changes</div>
                {edited && <span className="pill">Unsaved changes</span>}
              </div>
            </div>
          </>
        )}
      </div>
      {children}
    </div>
  );
}
