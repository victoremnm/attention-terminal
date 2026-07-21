// The "real builders" chat answer (issue #25 / AGENT-FLEET-PLAN.md §4.2). Mirrors
// digest.ts's shape: a pure builder fn consumed by agent-tools.ts's tool wrapper.
// Wraps the DevScatter read fn (src/lib/queries.ts) into a single SkinnyCard whose
// `visual` is a DevScatterVisual and whose `query` carries the real sql/rowsRead/
// elapsedMs - so chat and the Daily Skinny deck share one contract and one flip.

import { devScatter, type DevScatterWindow } from "./queries";
import { SkinnyDeckSchema, type DevPoint, type SkinnyDeckPayload, type Verdict } from "./render-payload";

function mergeRateOf(points: DevPoint[]) {
  const totalPrs = points.reduce((sum, p) => sum + p.prs, 0);
  const totalMerged = points.reduce((sum, p) => sum + p.mergedPrs, 0);
  return totalPrs > 0 ? totalMerged / totalPrs : 0;
}

// No time-series baseline exists for a per-actor scatter (unlike the divergence/
// candles verdicts), so the verdict here reads the *composition* of the kept
// population: how much of its opened-PR volume actually merged, and how much of
// it spans multiple repos rather than one.
function verdictForBuilders(points: DevPoint[], mergeRate: number): Verdict {
  if (points.length === 0) return "DORMANT";
  const spreadShare = points.filter((p) => p.repos >= 2).length / points.length;
  if (mergeRate >= 0.75 && spreadShare >= 0.5) return "BREAKOUT";
  if (mergeRate >= 0.45) return "ACCELERATING";
  if (mergeRate <= 0.15) return "COOLING";
  return "PEAKING";
}

export async function realBuildersDeck(window: DevScatterWindow = "7d"): Promise<SkinnyDeckPayload> {
  const result = await devScatter(window);
  const mergeRate = mergeRateOf(result.data);
  const shown = result.data.length;
  const kept = result.keptCount; // total that cleared the filter; `shown` is the plotted top-N
  const spreadCount = result.data.filter((p) => p.repos >= 2).length;
  const metricPct = Math.round(mergeRate * 100);
  // `shown` is a top-N slice of `kept` (devScatter LIMITs the scatter). Say so, so the
  // card never presents a truncated sample as the whole population.
  const showingSuffix = kept > shown ? ` (showing top ${shown} by merged-PR signal)` : "";

  const caption = `${kept} account${kept === 1 ? "" : "s"} cleared the bot/script-spam filter in the ${window} window${showingSuffix}; ${spreadCount} of the shown builders ship across 2+ repos.${
    result.note ? ` ${result.note}` : ""
  }`;

  const card = {
    id: `real-builders-${window}`,
    subject: "The Real Builders",
    verdict: verdictForBuilders(result.data, mergeRate),
    metric: `${metricPct}%`,
    metricLabel: "merged-PR rate, shown builders",
    caption,
    sources: `${kept} kept · showing ${shown} · ${window}`,
    visual: {
      kind: "dev-scatter" as const,
      window,
      points: result.data,
      note: result.note,
    },
    query: {
      sql: result.sql,
      rowsRead: result.rowsRead,
      elapsedMs: result.elapsedMs,
    },
  };

  return SkinnyDeckSchema.parse({
    type: "skinny-deck",
    dateStr: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    cards: [card],
  });
}
