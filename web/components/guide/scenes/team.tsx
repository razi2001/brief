import { BrowserFrame } from "../mock/Browser";
import { MockAcme } from "../mock/Acme";
import { MockPopup, type Tile } from "../mock/Popup";
import { MockApp } from "../mock/App";
import { MockBashList, MockBashNew, MockBashPage, type BashListS, type BashNewS, type BashPageS } from "../mock/Bash";
import { AT, scene } from "./types";

const APP = "cloud.get-brief.app";

type BashS = {
  list?: BashListS;
  form?: BashNewS;
  page?: BashPageS;
  /** On Acme with the popup open: the brief, and the Create button pressed. */
  popup?: { tiles?: Tile[]; desc?: string; createDown?: boolean; toast?: string; fly?: boolean; cloud?: "landed" };
};

const BASH = { name: "Checkout", left: "24:10", hold: true };
const VIDEO: Tile = { kind: "video", label: "Recording" };
const TEAM = (you: number) => [
  { name: "Sam Rivera", n: 4 },
  { name: "Ana Costa", n: 3 },
  { name: "You", n: you, you: true },
  { name: "Lee Park", n: 1 },
];
const sorted = (you: number) => TEAM(you).sort((x, y) => y.n - x.n);

export const bugbash = scene<BashS>({
  poster: 8,
  frames: [
    // 0: make one, from the list (or one of the suggested areas)
    { ms: 1100, step: 0, target: "bash-suggested", click: true, s: { list: { suggestOn: true } } },
    { ms: 1000, step: 0, target: "bash-new", click: true, s: { list: { newOn: true } } },
    { ms: 1800, step: 0, target: "bash-name", s: { form: { name: "Checkout", typing: true, hold: true } } },
    // 1: reports wait for a review, then the invite link
    { ms: 1100, step: 1, target: "bash-hold", s: { form: { name: "Checkout", hold: true, holdOn: true } } },
    { ms: 1000, step: 1, target: "bash-create", click: true, s: { form: { name: "Checkout", hold: true, createOn: true } } },
    { ms: 1300, step: 1, target: "bash-copy", click: true, s: { page: { me: "join", copied: true, copyOn: true } } },
    // 2: join, then start your own clock
    { ms: 1000, step: 2, target: "bash-join", click: true, s: { page: { me: "join", meOn: true, board: [{ name: "Sam Rivera", n: 0 }] } } },
    { ms: 1100, step: 2, target: "bash-start", click: true, s: { page: { me: "start", meOn: true, board: [{ name: "Sam Rivera", n: 0 }, { name: "You", n: 0, you: true }] } } },
    { ms: 1600, step: 2, cursor: AT.rest, s: { page: { me: "testing", left: "30:00", ring: 1, found: 5, board: sorted(0) } } },
    // 3: what you file from the extension counts
    { ms: 1300, step: 3, target: "bash-row", s: { popup: { tiles: [VIDEO], desc: "Pay does nothing" } } },
    { ms: 1000, step: 3, target: "create", click: true, s: { popup: { tiles: [VIDEO], desc: "Pay does nothing", createDown: true } } },
    { ms: 1500, step: 3, target: "create", s: { popup: { fly: true, cloud: "landed", toast: "Ticket queued" } } },
    // 4: the board, then the review once it is over
    { ms: 1700, step: 4, cursor: AT.rest, s: { page: { me: "testing", left: "21:40", ring: 0.72, found: 7, board: sorted(2) } } },
    { ms: 1300, step: 4, target: "bash-file", s: { page: { review: true } } },
    { ms: 1000, step: 4, target: "bash-file", click: true, s: { page: { review: true, fileOn: true } } },
    { ms: 2000, step: 4, cursor: AT.rest, s: { page: { review: true, filed: true } } },
  ],
  View: ({ s }) =>
    s.popup ? (
      <BrowserFrame url="acme.com/checkout" title="Checkout · Acme" brief={{ pinned: true, open: true }} overlay={<MockPopup {...s.popup} bash={BASH} />}>
        <MockAcme page="checkout" />
      </BrowserFrame>
    ) : (
      <BrowserFrame url={`${APP}/bash`} title="Bug bash · Brief" fav="#dd6936">
        <MockApp active="Bug bash">
          {s.form ? <MockBashNew s={s.form} /> : s.page ? <MockBashPage s={s.page} /> : <MockBashList s={s.list ?? {}} />}
        </MockApp>
      </BrowserFrame>
    ),
});
