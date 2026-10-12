import type { ReactNode } from "react";
import BrandMark from "@/components/BrandMark";
import { IconBack, IconForward, IconPuzzle, IconRefresh } from "./icons";

export type BriefIcon = {
  /** Brief pinned in the toolbar (it isn't until the install lesson pins it). */
  pinned?: boolean;
  /** The popup is open (the icon looks pressed). */
  open?: boolean;
  /** A one-click report running: the icon turns. */
  busy?: boolean;
  /** The badge Chrome shows on the icon: "✓" (green) after a report. */
  badge?: string;
  /** Draw attention to it. */
  hl?: boolean;
};

/**
 * A Chrome window: one tab, the toolbar with the address, the extensions
 * puzzle and Brief's icon. The page is `children`; `overlay` sits above it
 * (the popup, Chrome's menus).
 */
export function BrowserFrame({
  url,
  title,
  fav = "#2f5bd3",
  brief = { pinned: true },
  puzzleOn,
  children,
  overlay,
}: {
  url: string;
  title: string;
  fav?: string;
  brief?: BriefIcon;
  puzzleOn?: boolean;
  children: ReactNode;
  overlay?: ReactNode;
}) {
  const slash = url.indexOf("/");
  const host = slash < 0 ? url : url.slice(0, slash);
  const path = slash < 0 ? "" : url.slice(slash);
  return (
    <div className="gd-browser">
      <div className="gd-tabs">
        <span className="dots">
          <i />
          <i />
          <i />
        </span>
        <span className="gd-tab">
          <span className="fav" style={{ background: fav }} />
          {title}
        </span>
        <span className="gd-tab off">+</span>
      </div>
      <div className="gd-urlbar">
        <span className="nav">
          <IconBack />
          <IconForward />
          <IconRefresh />
        </span>
        <span className="gd-url">
          <span>{host}</span>
          <span className="path">{path}</span>
        </span>
        <span data-gd="puzzle" className={`gd-ticon${puzzleOn ? " on" : ""}`}>
          <IconPuzzle />
        </span>
        {brief.pinned && (
          <span data-gd="brief-icon" className={`gd-ticon gd-in${brief.open ? " on" : ""}${brief.busy ? " spin" : ""}${brief.hl ? " gd-hl" : ""}`}>
            <BrandMark className="brief" />
            {brief.badge && <span className="gd-badge">{brief.badge}</span>}
          </span>
        )}
      </div>
      <div className="gd-page">{children}</div>
      {overlay}
    </div>
  );
}
