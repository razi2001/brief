"use client";

import { memo, useEffect, useRef } from "react";
import { initDemo } from "./try-it-demo-machine";
import { sendEvent } from "../usage";
import "./try-it-demo.css";

/**
 * The get-brief.app hero demo, inside onboarding: report two planted bugs on
 * a fake checkout, about a minute. Markup, CSS (try-it-demo.css, scoped under
 * .try-demo) and state machine (try-it-demo-machine.ts) are the website's, so
 * the experience is the same; the website stays the source of truth for its
 * look. React renders the markup once and never again (memo, static JSX); the
 * machine owns the DOM from there and is torn down on unmount.
 */
function TryItDemo({ onOpenGuide }: { onOpenGuide: () => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  // A new callback must not restart the demo: read it through a ref.
  const guideRef = useRef(onOpenGuide);
  useEffect(() => {
    guideRef.current = onOpenGuide;
  });
  useEffect(() => initDemo(stageRef.current!, { onOpenGuide: () => guideRef.current() }), []);
  // Each demo button once per mount, for the activity log: how far people get.
  useEffect(() => {
    const stage = stageRef.current!;
    const seen = new Set<string>();
    const onAct = (e: Event) => {
      const act = (e.target as Element | null)?.closest?.("[data-act]")?.getAttribute("data-act");
      if (!act || seen.has(act)) return;
      seen.add(act);
      sendEvent("onboarding.demo", { act });
    };
    stage.addEventListener("click", onAct, true);
    return () => stage.removeEventListener("click", onAct, true);
  }, []);

  return (
    <div className="try-demo">
      <Sprite />
      {/* the live demo: a checkout with two planted bugs */}
      <div className="stage" ref={stageRef} data-phase="idle" role="region" aria-label="Live demo of Brief">
        <div className="win-wrap">
          <div className="win">
            <div className="wt">
              <span className="dots" aria-hidden="true"><i></i><i></i><i></i></span>
              <div className="tab"><svg className="tab-fav" aria-hidden="true"><use href="#td-lg-acme" /></svg><span className="tab-t">Checkout · Acme</span></div>
            </div>
            <div className="wtool">
              <span className="navs" aria-hidden="true"><svg><use href="#td-i-back" /></svg><svg><use href="#td-i-fwd" /></svg><svg><use href="#td-i-reload" /></svg></span>
              <div className="url"><svg aria-hidden="true"><use href="#td-i-lock" /></svg><span className="url-t">acme.shop/checkout</span></div>
              <span className="ext ext-puzzle" aria-hidden="true"><svg><use href="#td-i-puzzle" /></svg></span>
              <button className="ext ext-brief" type="button" data-t="brief" data-act="brief" aria-label="Open Brief">
                <svg viewBox="0 0 128 128" aria-hidden="true"><use href="#td-mark" /></svg><span className="rec-dot"></span>
              </button>
            </div>

            <div className="wb">
              {/* Acme's checkout: Pay is broken on purpose */}
              <div className="acme">
                <div className="a-nav">
                  <span className="a-logo"><i></i>Acme</span>
                  <span className="a-links"><span>Products</span><span>Pricing</span><span>Account</span></span>
                  <span className="a-cart">Cart <b>1</b></span>
                </div>
                <div className="a-main">
                  <div className="a-card">
                    <div className="a-h">Checkout</div>
                    <div className="a-sub">Acme Pro, billed monthly</div>
                    <div className="a-l">Email</div><div className="a-f">sam@acme.shop</div>
                    <div className="a-l">Card</div><div className="a-f"><span className="a-brand"></span>4242 4242 4242 4242</div>
                    <div className="a-row">
                      <div><div className="a-l">Expiry</div><div className="a-f">12 / 28</div></div>
                      <div className="a-cvc" data-t="cvc"><div className="a-l">CVC</div><div className="a-f">•••</div></div>
                    </div>
                    <button className="a-btn" type="button" data-t="pay" data-act="pay"><span className="a-btn-t">Pay $49.00</span><span className="a-btn-f">Payment failed</span><span className="spin"></span></button>
                    <div className="a-err" hidden><svg aria-hidden="true"><use href="#td-i-alert" /></svg>Something went wrong. Error 500.</div>
                    <div className="a-secure">Secured by AcmePay</div>
                  </div>
                  <div className="a-card a-sum">
                    <div className="a-plan"><i></i><div><b>Acme Pro</b><span>Monthly plan</span></div></div>
                    <div className="a-line"><span>Subtotal</span><span>$49.00</span></div>
                    <div className="a-line mut"><span>Tax</span><span>$0.00</span></div>
                    <div className="a-tot"><span>Total</span><span>$49.00</span></div>
                  </div>
                </div>
              </div>

              <div className="caught" hidden></div>
              <div className="cap"><span className="mi"><svg aria-hidden="true"><use href="#td-i-mic" /></svg></span><span className="cap-t"></span></div>
              <div className="recbar">
                <span className="rdot"></span><span className="rec-t">00:00</span>
                <span className="wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
                <button className="stop" type="button" data-t="stop" data-act="stop" aria-label="Stop recording"><i></i></button>
              </div>
              <div className="cd" aria-hidden="true"><span>3</span></div>

              <div className="shotlayer">
                <div className="flash"></div>
                <canvas aria-label="Draw on the screenshot"></canvas>
                <div className="shot-bar">
                  <span className="lbl"><span className="pen"></span>Draw on it</span>
                  <button className="sb-btn" type="button" data-t="shot-undo" data-act="shotUndo">Undo</button>
                  <button className="sb-btn" type="button" data-act="shotCancel">Cancel</button>
                  <button className="sb-btn pri" type="button" data-t="shot-save" data-act="shotSave">Save</button>
                </div>
              </div>

              {/* the ticket, as your tracker shows it */}
              <div className="tk" aria-live="polite">
                <div className="tk-top">
                  <div className="tk-crumb"><svg className="tk-logo" aria-hidden="true"><use href="#td-lg-linear" /></svg><span className="tk-team">Engineering</span><span className="tk-sl">›</span><span className="tk-id">ENG-142</span></div>
                  <div className="tk-seg" role="group" aria-label="Pick a tracker">
                    <button type="button" data-t="trk-linear" data-act="tracker" data-arg="linear" aria-pressed="true" aria-label="Linear"><svg aria-hidden="true"><use href="#td-lg-linear" /></svg><span className="nm">Linear</span></button>
                    <button type="button" data-t="trk-jira" data-act="tracker" data-arg="jira" aria-pressed="false" aria-label="Jira"><svg aria-hidden="true"><use href="#td-lg-jira" /></svg><span className="nm">Jira</span></button>
                    <button type="button" data-t="trk-github" data-act="tracker" data-arg="github" aria-pressed="false" aria-label="GitHub"><svg aria-hidden="true"><use href="#td-lg-github" /></svg><span className="nm">GitHub</span></button>
                  </div>
                  <button className="tk-file btn btn-acc btn-sm" type="button" data-t="file" data-act="fileDraft">File it</button>
                </div>
                <div className="tk-scroll">
                  <div className="tk-grid">
                    <article className="tk-main">
                      <div className="tk-draftnote" data-r="">Saved in Drafts. Read it over, then file it.</div>
                      <h3 className="tk-title"></h3>
                      <div><span className="tk-by" data-r=""><svg viewBox="0 0 128 128" aria-hidden="true"><use href="#td-mark" /></svg>Written by Brief in 9 seconds</span></div>
                      <section data-r="">
                        <h4>Summary</h4>
                        <p className="tk-sum"></p>
                        <p className="tk-note" hidden></p>
                      </section>
                      <section data-r="">
                        <h4>Steps to reproduce</h4>
                        <ol className="tk-steps"></ol>
                      </section>
                      <section className="tk-ea" data-r="">
                        <div><h4>Expected</h4><p className="tk-exp"></p></div>
                        <div><h4>Actual</h4><p className="tk-act"></p></div>
                      </section>
                      <section data-r="">
                        <h4>Evidence</h4>
                        <div className="tk-ev"></div>
                      </section>
                      <section className="tk-logs" data-r="">
                        <h4>Console and network</h4>
                        <pre>
                          <span className="e">{"✕ TypeError: Cannot read properties of undefined (reading 'id')"}</span>
                          {"\n"}
                          <span className="d">{"    at submitPayment (checkout.js:88)"}</span>
                          {"\n"}
                          <span className="e">{"✕ POST /api/pay   500   612 ms"}</span>
                        </pre>
                      </section>
                      <section data-r="">
                        <h4>Environment</h4>
                        <p>Chrome 141 on macOS · 1440 x 900 · acme.shop/checkout</p>
                      </section>
                    </article>
                    <aside className="tk-side" data-r="">
                      <dl>
                        <dt>Status</dt><dd><span className="sd"></span><span className="tk-status">Todo</span></dd>
                        <dt>Priority</dt><dd><span className="pri-ic" aria-hidden="true"><i style={{ height: 4 }}></i><i style={{ height: 7 }}></i><i style={{ height: 11 }}></i></span>High</dd>
                        <dt>Labels</dt><dd><span className="lab"><i style={{ background: "#e5484d" }}></i>Bug</span><span className="lab tk-lab2"><i style={{ background: "#2f5bd3" }}></i>Checkout</span></dd>
                        <dt className="opt">Reporter</dt><dd className="opt">You, via Brief</dd>
                        <dt className="opt">Assignee</dt><dd className="opt" style={{ color: "#8b8f96", fontWeight: 400 }}>Unassigned</dd>
                      </dl>
                    </aside>
                  </div>
                </div>
                <div className="tk-end">
                  <p className="tk-endp"></p>
                  <button className="btn btn-acc btn-sm tk-next" type="button" data-act="goal" data-arg="pay">Let&apos;s go<svg aria-hidden="true"><use href="#td-i-arrow" /></svg></button>
                  <button className="btn btn-acc btn-sm tk-guide" type="button" data-act="guide">Open the Guide<svg className="arr" aria-hidden="true"><use href="#td-i-arrow" /></svg></button>
                  <button className="btn btn-ghost btn-sm tk-again" type="button" data-act="again"><svg aria-hidden="true"><use href="#td-i-reset" /></svg>Play again</button>
                </div>
              </div>
            </div>

            {/* the Brief popup */}
            <div className="pop" role="dialog" aria-label="Brief">
              <div className="pop-hd">
                <svg className="mk" viewBox="0 0 128 128" aria-hidden="true"><use href="#td-mark" /></svg>
                <span className="pop-title">What&apos;s the <em>brief</em>?</span>
                <button className="hb" type="button" data-act="restart" aria-label="Start this brief over"><svg aria-hidden="true"><use href="#td-i-reset" /></svg></button>
                <span className="hb cloud-btn" aria-hidden="true"><svg><use href="#td-i-cloud" /></svg></span>
              </div>
              <div className="pop-part">
                <div className="pop-lbl">Evidence<span className="n">0</span></div>
                <div className="gal">
                  <div className="tiles"></div>
                  <button className="add" type="button" data-t="add" data-act="add"><span className="plus"><svg aria-hidden="true"><use href="#td-i-plus" /></svg></span>Add</button>
                </div>
              </div>
              <div className="pop-part">
                <div className="pop-lbl">Additional data</div>
                <div className="field">
                  <textarea className="note" data-t="note" placeholder="Describe the brief…" aria-label="Describe the bug"></textarea>
                  <span className="mic" aria-hidden="true"><svg><use href="#td-i-mic" /></svg></span>
                </div>
              </div>
              <div className="go">
                <button className="create" type="button" data-t="create" data-act="create" disabled>Create ticket</button>
                <button className="savedraft" type="button" data-t="draft" data-act="draft" disabled>Save as draft</button>
              </div>
              <div className="scrim" data-act="sheetClose"></div>
              <div className="sheet">
                <div className="handle"></div>
                <div className="sh">
                  <span className="st">Add to <em>brief</em></span>
                  <button className="sbtn" type="button" data-act="sheetClose" aria-label="Close"><svg aria-hidden="true"><use href="#td-i-x" /></svg></button>
                </div>
                <div className="choices">
                  <button className="choice" type="button" data-t="choice-shot" data-act="shot"><span className="ci"><svg aria-hidden="true"><use href="#td-i-shot" /></svg></span><span><span className="ct">Screenshot</span><span className="cs" style={{ display: "block" }}>0 of 3</span></span><span className="chev"><svg aria-hidden="true"><use href="#td-i-chev" /></svg></span></button>
                  <button className="choice" type="button" data-t="choice-video" data-act="video"><span className="ci"><svg aria-hidden="true"><use href="#td-i-video" /></svg></span><span><span className="ct">Video</span><span className="cs" style={{ display: "block" }}>Record the screen</span></span><span className="chev"><svg aria-hidden="true"><use href="#td-i-chev" /></svg></span></button>
                  <button className="choice" type="button" data-t="choice-replay" data-act="replay"><span className="ci"><svg aria-hidden="true"><use href="#td-i-replay" /></svg></span><span><span className="ct">Replay</span><span className="cs" style={{ display: "block" }}>The last 60 seconds</span></span><span className="chev"><svg aria-hidden="true"><use href="#td-i-chev" /></svg></span></button>
                </div>
              </div>
              <div className="pop-toast"><svg aria-hidden="true"><use href="#td-i-check" /></svg><span></span></div>
            </div>

            <div className="scene" aria-hidden="true"><div className="scene-card"><span className="scene-n"></span><b className="scene-t"></b><span className="scene-s"></span></div></div>
            <div className="ring" aria-hidden="true"></div>
            <div className="coach" aria-live="polite"><div className="coach-in"><span className="coach-t"></span></div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(TryItDemo);

/** The shapes the demo draws with: the Brief mark, tracker logos, icons. */
function Sprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <linearGradient id="td-mk-tile" x1="20" y1="6" x2="112" y2="124" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f08147" /><stop offset=".52" stopColor="#dd6936" /><stop offset="1" stopColor="#bd4f1c" />
        </linearGradient>
        <linearGradient id="td-mk-sheen" x1="64" y1="0" x2="64" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".3" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <symbol id="td-mark" viewBox="0 0 128 128">
        <rect width="128" height="128" rx="28" fill="url(#td-mk-tile)" />
        <rect width="128" height="66" rx="28" fill="url(#td-mk-sheen)" />
        <g fill="#f7f3ea">
          <path d="M26 38 Q26 26 38 26 L52 26 L52 34 L40 34 Q34 34 34 40 L34 52 L26 52 Z M26 90 Q26 102 38 102 L52 102 L52 94 L40 94 Q34 94 34 88 L34 76 L26 76 Z M102 90 Q102 102 90 102 L76 102 L76 94 L88 94 Q94 94 94 88 L94 76 L102 76 Z" />
          <path d="M64 40 C67 52, 76 61, 88 64 C76 67, 67 76, 64 88 C61 76, 52 67, 40 64 C52 61, 61 52, 64 40 Z" />
        </g>
        <g fill="#fff"><ellipse cx="84" cy="40" rx="8" ry="7" /><ellipse cx="95" cy="35" rx="10" ry="9" /><ellipse cx="104" cy="40" rx="7" ry="6" /><rect x="80" y="38" width="28" height="9" rx="4" /></g>
      </symbol>
      <symbol id="td-lg-linear" viewBox="0 0 24 24"><path fill="#5E6AD2" d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z" /></symbol>
      <symbol id="td-lg-jira" viewBox="0 0 24 24"><path fill="#2684FF" d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0Z" /></symbol>
      <symbol id="td-lg-github" viewBox="0 0 24 24"><path fill="#181717" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></symbol>
      <symbol id="td-lg-acme" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="3.5" transform="rotate(45 12 12)" fill="#2f5bd3" /></symbol>
      <symbol id="td-i-alert" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9.5" /><path d="M12 7.5v5.5M12 16.5v.01" /></g></symbol>
      <symbol id="td-i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></symbol>
      <symbol id="td-i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></symbol>
      <symbol id="td-i-play" viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor" /></symbol>
      <symbol id="td-i-cloud" viewBox="0 0 24 24"><path d="M17.5 19a4.5 4.5 0 0 0 0-9 6.5 6.5 0 0 0-12.5 2.2A4.5 4.5 0 0 0 6.5 19z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></symbol>
      <symbol id="td-i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></symbol>
      <symbol id="td-i-x" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></symbol>
      <symbol id="td-i-mic" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></g></symbol>
      <symbol id="td-i-video" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="13" height="12" rx="2" /><path d="m15 10 6-3.5v11L15 14" /></g></symbol>
      <symbol id="td-i-shot" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></g></symbol>
      <symbol id="td-i-replay" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 8v4l3 2" /></g></symbol>
      <symbol id="td-i-chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></symbol>
      <symbol id="td-i-reset" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></g></symbol>
      <symbol id="td-i-lock" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></g></symbol>
      <symbol id="td-i-puzzle" viewBox="0 0 24 24"><path d="M10 3.5a2 2 0 1 1 4 0V5h4a1 1 0 0 1 1 1v4h-1.5a2 2 0 1 0 0 4H19v4a1 1 0 0 1-1 1h-4v-1.5a2 2 0 1 0-4 0V19H6a1 1 0 0 1-1-1v-4h1.5a2 2 0 1 0 0-4H5V6a1 1 0 0 1 1-1h4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></symbol>
      <symbol id="td-i-back" viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></symbol>
      <symbol id="td-i-fwd" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></symbol>
      <symbol id="td-i-reload" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></g></symbol>
    </svg>
  );
}
