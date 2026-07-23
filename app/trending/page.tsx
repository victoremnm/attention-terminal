import { RepoRankingsSurface } from "@/components/RepoRankingsSurface";
import type { RankingMode } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function TrendingPage(props: { searchParams: Promise<{ mode?: string }> }) {
  const searchParams = await props.searchParams;
  const mode = (searchParams.mode as RankingMode) ?? "events";
  return <RepoRankingsSurface mode={mode} />;
}
