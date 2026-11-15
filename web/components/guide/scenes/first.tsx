import { BrowserFrame } from "../mock/Browser";
import { MockAcme } from "../mock/Acme";
import { MockPopup, type Sheet, type Tile } from "../mock/Popup";
import { MockBar } from "../mock/Bar";
import { MockEditor } from "../mock/Editor";
import { MockShot } from "../mock/Shot";
import { MockApp, MockFeed, type Row } from "../mock/App";
import { AT, scene } from "./types";

const APP = "cloud.get-brief.app";

type PopupState = {
  tiles?: Tile[];
  addOn?: boolean;
  wayOn?: "shot" | "video" | "replay";
  bash?: { name: string; left: string; hold?: boolean };
  sheet?: Sheet;
  desc?: string;
  typing?: boolean;
  fieldOn?: boolean;
  createDown?: boolean;
  mode?: "ticket" | "draft" | "prompt";
  menuOn?: boolean;
  menuHover?: "ticket" | "draft" | "prompt";
  toast?: string;
  fly?: boolean;
  cloud?: "landed" | "unseen" | "sending";
};

/** Acme's checkout in Chrome, with Brief's popup open or not. */
function OnCheckout({ popup, paying, children }: { popup?: PopupState; paying?: boolean; children?: React.ReactNode }) {
  return (
    <BrowserFrame url="acme.com/checkout" title="Checkout · Acme" brief={{ pinned: true, open: !!popup }} overlay={popup && <MockPopup {...popup} />}>
      <MockAcme page="checkout" paying={paying} />
      {children}
    </BrowserFrame>
  );
}

// ---------------------------------------------------------------- record

type Ed = { keep: [number, number]; crop?: boolean; tool?: "crop" | "mark"; mark?: { at: number; note?: string }; saveOn?: boolean };
type RecordS = { popup?: PopupState; count?: number; rec?: string; paying?: boolean; ed?: Ed; shot?: { drawn?: boolean; saveOn?: boolean } };

const VIDEO: Tile = { kind: "video", label: "Recording" };
const SHOT: Tile = { kind: "shot" };
const NOTE = "Pay does nothing, no error";
// the red loop, around Pay on the checkout capture
const AROUND_PAY = { left: 59, top: 28.5, width: 39, height: 14 };

export const record = scene<RecordS>({
  poster: 10,
  frames: [
    { ms: 900, step: 0, cursor: AT.rest, s: {} },
    { ms: 1000, step: 0, target: "brief-icon", click: true, s: {} },
    { ms: 1300, step: 0, target: "choice-video", click: true, s: { popup: { wayOn: "video" } } },
    { ms: 650, step: 0, s: { count: 3 } },
    { ms: 650, step: 0, s: { count: 2 } },
    { ms: 650, step: 0, s: { count: 1 } },
    { ms: 1000, step: 1, target: "pay", s: { rec: "00:02" } },
    { ms: 1000, step: 1, target: "pay", click: true, s: { rec: "00:04" } },
    { ms: 900, step: 1, target: "pay", s: { rec: "00:05", paying: true } },
    { ms: 1000, step: 1, target: "stop", click: true, s: { rec: "00:07" } },
    { ms: 1500, step: 1, cursor: AT.rest, s: { popup: { tiles: [{ ...VIDEO, on: true }] } } },
    { ms: 1000, step: 2, target: "tile-0", click: true, s: { popup: { tiles: [VIDEO] } } },
    { ms: 900, step: 2, target: "h-start", s: { ed: { keep: [0, 100] } } },
    { ms: 1000, step: 2, target: "h-start", s: { ed: { keep: [30, 100] } } },
    { ms: 1300, step: 2, keys: ["C"], s: { ed: { keep: [30, 100], crop: true, tool: "crop" } } },
    { ms: 1000, step: 2, target: "tool-mark", click: true, s: { ed: { keep: [30, 100], crop: true, tool: "mark", mark: { at: 52 } } } },
    { ms: 1600, step: 2, target: "tool-mark", s: { ed: { keep: [30, 100], crop: true, mark: { at: 52, note: "Pay does nothing" } } } },
    { ms: 1100, step: 2, target: "ed-save", click: true, s: { ed: { keep: [30, 100], crop: true, mark: { at: 52 }, saveOn: true } } },
    { ms: 1000, step: 3, target: "add", click: true, s: { popup: { tiles: [VIDEO], addOn: true } } },
    { ms: 1100, step: 3, target: "choice-shot", click: true, s: { popup: { tiles: [VIDEO], sheet: { kind: "chooser", on: "shot" } } } },
    { ms: 1800, step: 3, target: "shot-mark:right", s: { shot: { drawn: true } } },
    { ms: 1100, step: 3, target: "shot-save", click: true, s: { shot: { drawn: true, saveOn: true } } },
    { ms: 1000, step: 4, target: "tile-1", click: true, s: { popup: { tiles: [VIDEO, { ...SHOT, on: true }] } } },
    { ms: 2200, step: 4, target: "note", s: { popup: { tiles: [VIDEO, SHOT], sheet: { kind: "shot", note: NOTE, typing: true } } } },
    { ms: 1500, step: 4, cursor: AT.rest, s: { popup: { tiles: [VIDEO, { ...SHOT, label: NOTE }] } } },
  ],
  View: ({ s }) =>
    s.ed ? (
      <BrowserFrame url="Brief Cloud · Recording" title="Recording" fav="#dd6936">
        <MockEditor kind="recording" page="checkout" keep={s.ed.keep} crop={s.ed.crop} tool={s.ed.tool} mark={s.ed.mark} actionOn={s.ed.saveOn} head={s.ed.keep[0] + 22} />
      </BrowserFrame>
    ) : (
      <OnCheckout popup={s.popup} paying={s.paying}>
        {s.count !== undefined && <MockBar count={s.count} />}
        {s.rec && <MockBar time={s.rec} />}
        {s.shot && <MockShot page="checkout" drawn={s.shot.drawn} saveOn={s.shot.saveOn} circle={AROUND_PAY} />}
      </OnCheckout>
    ),
});

// ---------------------------------------------------------------- create the ticket

type CreateS = { popup?: PopupState; feed?: "filing" | "filed" | "drafts" };

const DESC = "Pay does nothing, no error";
const OLDER: Row[] = [
  { id: "ENG-139", title: "Search hangs on order numbers", status: { label: "In Progress", type: "started" }, ago: 190 },
  { id: "ENG-131", title: "Coupon field accepts expired codes", status: { label: "Done", type: "completed" }, ago: 2900 },
];

export const create = scene<CreateS>({
  poster: 3,
  frames: [
    { ms: 900, step: 0, target: "field", click: true, s: { popup: { tiles: [VIDEO] } } },
    { ms: 1900, step: 0, target: "field", s: { popup: { tiles: [VIDEO], desc: DESC, typing: true, fieldOn: true } } },
    { ms: 1000, step: 1, target: "create", click: true, s: { popup: { tiles: [VIDEO], desc: DESC, createDown: true } } },
    { ms: 2000, step: 1, target: "create", s: { popup: { fly: true, cloud: "landed", toast: "Ticket queued" } } },
    { ms: 1300, step: 2, cursor: AT.rest, s: { feed: "filing" } },
    { ms: 2000, step: 2, cursor: AT.rest, s: { feed: "filed" } },
    { ms: 1100, step: 3, target: "caret", click: true, s: { popup: { tiles: [VIDEO], desc: DESC, menuOn: true } } },
    { ms: 1100, step: 3, target: "m-draft", click: true, s: { popup: { tiles: [VIDEO], desc: DESC, menuOn: true, menuHover: "draft" } } },
    { ms: 1100, step: 3, target: "create", click: true, s: { popup: { tiles: [VIDEO], desc: DESC, mode: "draft", createDown: true } } },
    { ms: 1600, step: 3, target: "create", s: { popup: { mode: "draft", fly: true, cloud: "landed", toast: "Link copied" } } },
    { ms: 2000, step: 3, cursor: AT.rest, s: { feed: "drafts" } },
  ],
  View: ({ s }) =>
    s.feed ? (
      <BrowserFrame url={`${APP}/tickets${s.feed === "drafts" ? "?show=drafts" : ""}`} title="Tickets · Brief Cloud" fav="#dd6936">
        <MockApp active="Tickets">
          {s.feed === "drafts" ? (
            <MockFeed
              draftsOnly
              rows={[
                { id: "brief-15", title: "Pay fails silently at checkout", status: "draft", ago: 0, fresh: true },
                { id: "brief-12", title: "Coupon field accepts expired codes", status: "draft", ago: 2900 },
              ]}
            />
          ) : (
            <MockFeed
              rows={[
                s.feed === "filing"
                  ? { id: "brief-14", title: "Pay fails silently at checkout", status: "filing", ago: 0, fresh: true }
                  : { id: "ENG-142", title: "Pay fails silently at checkout", status: { label: "Todo", type: "unstarted" }, ago: 0, fresh: true },
                ...OLDER,
              ]}
            />
          )}
        </MockApp>
      </BrowserFrame>
    ) : (
      <OnCheckout popup={s.popup} />
    ),
});
