import type { Metadata } from "next";
import { TrendingSurface } from "@/components/TrendingSurface";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Attention Terminal - Live Feed",
  description: "Live GitHub and Hacker News breakout signals, shipping velocity, and story trends.",
};

export default async function Home() {
  return <TrendingSurface />;
}
