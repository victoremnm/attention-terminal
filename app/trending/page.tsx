import type { Metadata } from "next";
import { RepoRankingsSurface } from "@/components/RepoRankingsSurface";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Attention Terminal - Repo Rankings",
  description: "GitHub repositories ranked by attention volume across 1-day, 7-day, and 30-day windows.",
};

export default async function TrendingPage(props: { searchParams: Promise<{ sort?: string }> }) {
  return <RepoRankingsSurface searchParams={props.searchParams} />;
}
