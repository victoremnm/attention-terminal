import { AttentionChat } from "@/components/AttentionChat";
import { DailySkinny } from "@/components/DailySkinny";
import { dailyDigest } from "@/lib/digest";
import { mintIngestReadToken } from "@/lib/realtime-actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [digest, ingestToken] = await Promise.all([dailyDigest(), mintIngestReadToken()]);
  return (
    <>
      <DailySkinny initial={digest} ingestToken={ingestToken ?? undefined} />
      <AttentionChat />
    </>
  );
}
