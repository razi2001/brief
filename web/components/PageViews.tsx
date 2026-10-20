"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { sendEvent } from "./usage";

/** One page.view per path the signed-in app shows, for the activity log. */
export default function PageViews() {
  const path = usePathname();
  useEffect(() => {
    if (path) sendEvent("page.view", { path });
  }, [path]);
  return null;
}
