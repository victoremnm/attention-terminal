import type { Metadata } from "next";
import { ModelsSurface } from "@/components/ModelsSurface";
import {
  hfModelsHeadline,
  hfTopModels,
  hfTrendingModels,
  hfAuthorLeaderboard,
  hfPipelineTagDistribution,
  hfLibraryDistribution,
  hfScanKindBreakdown,
  hfTagFrequency,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Attention Terminal - Models",
  description: "Curated Hugging Face model leaderboard with trending velocity, scan-kind breakdown, and author rankings.",
};

export default async function ModelsPage() {
  const [
    headlineResult,
    topModelsResult,
    trendingResult,
    authorResult,
    pipelineResult,
    libraryResult,
    scanKindResult,
    tagResult,
  ] = await Promise.all([
    hfModelsHeadline(),
    hfTopModels("downloads", 100),
    hfTrendingModels(20),
    hfAuthorLeaderboard(15),
    hfPipelineTagDistribution(),
    hfLibraryDistribution(),
    hfScanKindBreakdown(),
    hfTagFrequency(15),
  ]);

  return (
    <ModelsSurface
      headline={headlineResult.data[0]}
      topModels={topModelsResult.data}
      trendingModels={trendingResult.data}
      authorLeaderboard={authorResult.data}
      pipelineTags={pipelineResult.data}
      libraryDistribution={libraryResult.data}
      scanKindBreakdown={scanKindResult.data}
      tagFrequency={tagResult.data}
    />
  );
}
