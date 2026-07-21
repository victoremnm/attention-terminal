import type { Verdict } from "./render-payload";

// Verdict -> color is a fixed mapping (design spec §4.4). Shared across
// RenderedAnswer, DailySkinny, and the tactile SkinnyDeck so the palette
// never drifts between surfaces.
export const VERDICT_COLOR: Record<Verdict, string> = {
  ACCELERATING: "var(--cyan)",
  PEAKING: "var(--amber)",
  COOLING: "var(--muted)",
  DORMANT: "var(--muted)",
  BREAKOUT: "var(--mag)",
  DIVERGENT: "var(--mag)",
};
