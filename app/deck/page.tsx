import { SkinnyDeck } from "@/components/SkinnyDeck";
import { SurfaceNav } from "@/components/SurfaceNav";
import { SkinnyDeckSchema } from "@/lib/render-payload";
import fixture from "../../fixtures/skinny-deck.json";

// Renderer demo surface for issue #27 — binds the tactile deck to the FROZEN
// fixture deck (fixtures/skinny-deck.json). Wiring this to live reads is #28.
export const dynamic = "force-static";

export default function DeckPage() {
  const payload = SkinnyDeckSchema.parse(fixture);

  return (
    <>
      <SurfaceNav active="deck" />
      <main className="deck-page">
        <SkinnyDeck payload={payload} />
      </main>
    </>
  );
}
