import { AttentionChat } from "@/components/AttentionChat";
import { DailySkinny } from "@/components/DailySkinny";
import { TickerRail } from "@/components/TickerRail";
import { dailyDigest } from "@/lib/digest";
import { tickerLanes } from "@/lib/queries";
import { mintIngestReadToken } from "@/lib/realtime-actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [digest, lanes, ingestToken] = await Promise.all([
    dailyDigest(),
    tickerLanes(),
    mintIngestReadToken(),
  ]);
  const token = ingestToken ?? undefined;
  return (
    <>
      <div className="ticker-shell">
        <TickerRail initial={lanes} ingestToken={token} />
      </div>
      <DailySkinny initial={digest} ingestToken={token} />
      <AttentionChat />
    </>
  );
}
