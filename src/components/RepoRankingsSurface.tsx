import { AttentionChat } from "@/components/AttentionChat";
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
    // `td` is not surfaced (gh_repo_daily retains ~30d, so it duplicates 30d),
    // but the map key is required by the RepoWindow type.
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
        <RepoRankings windows={windows} />
      </main>
      <AttentionChat />
    </>
  );
}
