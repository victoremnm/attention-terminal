import { ChatCtaBanner } from "@/components/ChatCtaBanner";
import { RepoRankings } from "@/components/RepoRankings";
import { SurfaceNav } from "@/components/SurfaceNav";
import { TopActorRepos } from "@/components/TopActorRepos";
import { repoActivityWindow, topActorRepos, type RepoWindow, type RepoWindowRow } from "@/lib/queries";

const RANKING_LIMIT = 100;
const TOP_ACTORS_LIMIT = 10;
const TOP_REPOS_PER_ACTOR = 5;

export async function RepoRankingsSurface() {
  const [d1, d7, d30, topActors7d, topActors30d] = await Promise.all([
    repoActivityWindow("1d", RANKING_LIMIT),
    repoActivityWindow("7d", RANKING_LIMIT),
    repoActivityWindow("30d", RANKING_LIMIT),
    topActorRepos("7d", TOP_ACTORS_LIMIT, TOP_REPOS_PER_ACTOR),
    topActorRepos("30d", TOP_ACTORS_LIMIT, TOP_REPOS_PER_ACTOR),
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
        <RepoRankings windows={windows} />

        <section style={{ marginTop: "48px", paddingTop: "32px", borderTop: "1px solid var(--line-soft)" }}>
          <header className="trending-head">
            <p className="skinny-kicker mono">TOP_CONTRIBUTORS</p>
            <h2 style={{ margin: "0 0 12px", fontSize: "32px" }}>Top Contributors</h2>
            <p className="trending-copy">
              Most active non-bot contributors and their top repositories. Switch between 7-day and 30-day windows to see short-term and long-term trends.
            </p>
          </header>
          <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
            <div>
              <h3 style={{ margin: "0 0 18px", fontSize: "16px", color: "var(--muted)" }}>7-Day Window</h3>
              <TopActorRepos data={topActors7d.data} window="7 days" fetchedAt={topActors7d.sql ? new Date().toISOString() : undefined} />
            </div>
            <div>
              <h3 style={{ margin: "0 0 18px", fontSize: "16px", color: "var(--muted)" }}>30-Day Window</h3>
              <TopActorRepos data={topActors30d.data} window="30 days" fetchedAt={topActors30d.sql ? new Date().toISOString() : undefined} />
            </div>
          </div>
        </section>

        <ChatCtaBanner />
      </main>
    </>
  );
}
