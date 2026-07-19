import { AttentionChat } from "@/components/AttentionChat";
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
      <SurfaceNav active="trending" />
      <main className="trending-shell">
        <header className="trending-head">
          <p className="skinny-kicker mono">LIVE_GITHUB_HN</p>
          <h1>Trending</h1>
          <p className="trending-copy">
            Breakout repo, fork, shipping, star, and story signals from the latest feed windows.
          </p>
        </header>
        <TickerRail initial={lanes} ingestToken={token} />
      </main>
      <AttentionChat />
    </>
  );
}
