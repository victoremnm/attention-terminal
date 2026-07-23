import { ChatCtaBanner } from "@/components/ChatCtaBanner";
import { RepoRankings } from "@/components/RepoRankings";
import { SurfaceNav } from "@/components/SurfaceNav";
import { repoActivityWindow, type RepoActivitySort, type RepoWindow, type RepoWindowRow } from "@/lib/queries";

export async function RepoRankingsSurface({ searchParams }: { searchParams?: Promise<{ sort?: string }> }) {
  const sort = (await searchParams)?.sort as RepoActivitySort | undefined;
  const options = { limit: 100, sort: sort ?? "events" };

  const [d1, d7, d30] = await Promise.all([
    repoActivityWindow("1d", options),
    repoActivityWindow("7d", options),
    repoActivityWindow("30d", options),
  ]);

  const windows: Record<RepoWindow, RepoWindowRow[]> = {
    "1d": d1.data,
    "7d": d7.data,
    "30d": d30.data,
    td: d30.data,
  };

  return (
    <>
      <SurfaceNav active="trending" />
      <main className="trending-shell">
        <header className="trending-head">
          <p className="skinny-kicker mono">REPO_RANKINGS</p>
          <h1>Repo Rankings</h1>
          <p className="trending-copy">
            GitHub repositories ranked by attention volume across 1-day, 7-day, and 30-day windows. Tap any repo to explore drilldown telemetry.
          </p>
        </header>
        <RepoRankings windows={windows} mode={sort ?? "events"} />
        <ChatCtaBanner />
      </main>
    </>
  );
}
