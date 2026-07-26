import { ChatCtaBanner } from "@/components/ChatCtaBanner";
import { HNStoryTicker } from "@/components/HNStoryStreamClient";
import { SurfaceNav } from "@/components/SurfaceNav";
import { TickerRail } from "@/components/TickerRail";
import { hnStoryFeed, tickerLanes } from "@/lib/queries";
import { mintIngestReadToken } from "@/lib/realtime-actions";

export async function TrendingSurface() {
  const emptyStoryFeed = { data: [], sql: "", rowsRead: 0, elapsedMs: 0 };
  const [lanes, ingestToken, storyResult] = await Promise.all([
    tickerLanes(),
    mintIngestReadToken(),
    hnStoryFeed(6, 8)
      .then((data) => ({ data, error: null as string | null }))
      .catch((error) => {
        console.warn("HN story ticker unavailable during initial render", error);
        return {
          data: emptyStoryFeed,
          error: error instanceof Error ? error.message : "HN story ticker unavailable",
        };
      }),
  ]);
  const token = ingestToken ?? undefined;
  const stories = { stories: storyResult.data, replies: [] };

  return (
    <>
      <SurfaceNav active="home" />
      <main className="trending-shell">
        <header className="trending-head">
          <p className="skinny-kicker mono">LIVE_FEED</p>
          <h1>Live Feed</h1>
          <p className="trending-copy">
            Breakout repositories, fork activity, shipping velocity, and Hacker News stories from live attention feed windows.
          </p>
        </header>
        <TickerRail initial={lanes} ingestToken={token} />
        <HNStoryTicker initial={stories} initialError={storyResult.error} ingestToken={token} />
        <ChatCtaBanner />
      </main>
    </>
  );
}
