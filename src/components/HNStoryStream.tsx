import { SurfaceNav } from "@/components/SurfaceNav";
import { HNStoryStreamClient } from "@/components/HNStoryStreamClient";
import { hnStoryStream, type HNStreamResult } from "@/lib/queries";
import { mintIngestReadToken } from "@/lib/realtime-actions";

export async function HNStoryStream() {
  const emptyStream: HNStreamResult = {
    stories: { data: [], sql: "", rowsRead: 0, elapsedMs: 0 },
    replies: [],
  };
  const [initialResult, ingestToken] = await Promise.all([
    hnStoryStream(6, 50)
      .then((data) => ({ data, error: null as string | null }))
      .catch((error) => {
        console.warn("HN story stream unavailable during initial render", error);
        return {
          data: emptyStream,
          error: error instanceof Error ? error.message : "HN story stream unavailable",
        };
      }),
    mintIngestReadToken(),
  ]);

  return (
    <>
      <SurfaceNav active="stories" />
      <HNStoryStreamClient
        initial={initialResult.data}
        initialError={initialResult.error}
        ingestToken={ingestToken ?? undefined}
      />
    </>
  );
}
