import type { Metadata } from "next";
import GuideHub from "@/components/guide/GuideHub";

export const metadata: Metadata = { title: "Guide · Brief Cloud" };

export default function GuidePage() {
  return <GuideHub />;
}
