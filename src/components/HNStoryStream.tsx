import { SurfaceNav } from "@/components/SurfaceNav";
import { HNStoryStreamClient } from "@/components/HNStoryStreamClient";
import { hnStoryStream, type HNStreamResult } from "@/lib/queries";
import { mintIngestReadToken } from "@/lib/realtime-actions";

export async function HNStoryStream() {
  const emptyStream: HNStreamResult = {
    stories: { data: [], sql: "", rowsRead: 0, elapsedMs: 0 },
    replies: [],
  };
  const [initial, ingestToken] = await Promise.all([
    hnStoryStream(6, 50).catch((error) => {
      console.warn("HN story stream unavailable during initial render", error);
      return emptyStream;
    }),
    mintIngestReadToken(),
  ]);

  return (
    <>
      <SurfaceNav active="stories" />
      <HNStoryStreamClient initial={initial} ingestToken={ingestToken ?? undefined} />
    </>
  );
}
