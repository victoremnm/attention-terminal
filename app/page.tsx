import { AttentionChat } from "@/components/AttentionChat";
import { DailySkinny } from "@/components/DailySkinny";
import { dailyDigest } from "@/lib/digest";

export const dynamic = "force-dynamic";

export default async function Home() {
  const digest = await dailyDigest();
  return (
    <>
      <DailySkinny initial={digest} />
      <AttentionChat />
    </>
  );
}
