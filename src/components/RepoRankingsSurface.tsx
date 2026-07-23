import { ChatCtaBanner } from "@/components/ChatCtaBanner";
import { RepoRankings } from "@/components/RepoRankings";
import { SurfaceNav } from "@/components/SurfaceNav";
import { repoActivityWindow, type RepoWindow, type RepoWindowRow } from "@/lib/queries";

const RANKING_LIMIT = 50;

export async function RepoRankingsSurface() {
  const [d1, d7, d30] = await Promise.all([
    repoActivityWindow("1d", RANKING_LIMIT),
    repoActivityWindow("7d", RANKING_LIMIT),
    repoActivityWindow("30d", RANKING_LIMIT),
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
          <p className="skinny-kicker mono">LIVE_GITHUB</p>
          <h1>Trending</h1>
          <p className="trending-copy">
            Repos ranked by attention volume across the latest feed windows. Tap any repo to
            render its live data.
          </p>
        </header>
        <RepoRankings windows={windows} />
        <ChatCtaBanner />
      </main>
    </>
  );
}
