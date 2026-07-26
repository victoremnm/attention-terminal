import { ChatCtaBanner } from "@/components/ChatCtaBanner";
import { HNStoryTicker } from "@/components/HNStoryStreamClient";
import { SurfaceNav } from "@/components/SurfaceNav";
import { TickerRail } from "@/components/TickerRail";
import { hnStoryFeed, tickerLanes } from "@/lib/queries";
import { mintIngestReadToken } from "@/lib/realtime-actions";

export async function TrendingSurface() {
  const emptyStoryFeed = { data: [], sql: "", rowsRead: 0, elapsedMs: 0 };
  const [lanes, ingestToken, storyFeed] = await Promise.all([
    tickerLanes(),
    mintIngestReadToken(),
    hnStoryFeed(6, 8).catch((error) => {
      console.warn("HN story ticker unavailable during initial render", error);
      return emptyStoryFeed;
    }),
  ]);
  const token = ingestToken ?? undefined;
  const stories = { stories: storyFeed, replies: [] };

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
        <HNStoryTicker initial={stories} ingestToken={token} />
        <ChatCtaBanner />
      </main>
    </>
  );
}
