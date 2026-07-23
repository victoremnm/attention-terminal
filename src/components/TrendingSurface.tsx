import { ChatCtaBanner } from "@/components/ChatCtaBanner";
import { SurfaceNav } from "@/components/SurfaceNav";
import { TickerRail } from "@/components/TickerRail";
import { tickerLanes } from "@/lib/queries";
import { mintIngestReadToken } from "@/lib/realtime-actions";

export async function TrendingSurface() {
  const [lanes, ingestToken] = await Promise.all([
    tickerLanes(),
    mintIngestReadToken(),
  ]);
  const token = ingestToken ?? undefined;

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
        <ChatCtaBanner />
      </main>
    </>
  );
}
