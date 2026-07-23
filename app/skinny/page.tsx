import { ChatCtaBanner } from "@/components/ChatCtaBanner";
import { DailySkinny } from "@/components/DailySkinny";
import { SurfaceNav } from "@/components/SurfaceNav";
import { dailyDigest } from "@/lib/digest";
import { mintIngestReadToken } from "@/lib/realtime-actions";

export const dynamic = "force-dynamic";

export default async function SkinnyPage() {
  const [digest, ingestToken] = await Promise.all([
    dailyDigest(),
    mintIngestReadToken(),
  ]);
  const token = ingestToken ?? undefined;

  return (
    <>
      <SurfaceNav active="skinny" />
      <DailySkinny initial={digest} ingestToken={token} />
      <ChatCtaBanner />
    </>
  );
}
