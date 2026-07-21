import { SkinnyDeck } from "@/components/SkinnyDeck";
import { SurfaceNav } from "@/components/SurfaceNav";
import { liveSkinnyDeck } from "@/lib/live-deck";

// The tactile Daily Skinny deck on LIVE ClickHouse data (issue #28). Each card's
// flip-to-view-SQL shows the exact query behind it (q() provenance), not a mock.
export const dynamic = "force-dynamic";

export default async function DeckPage() {
  const payload = await liveSkinnyDeck();

  return (
    <>
      <SurfaceNav active="deck" />
      <main className="deck-page">
        <SkinnyDeck payload={payload} />
      </main>
    </>
  );
}
