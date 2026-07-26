import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ModelsSurface } from "./ModelsSurface";
import type {
  HfHeadlineRow,
  HfTopModelRow,
  HfTrendingModelRow,
  HfAuthorRow,
  HfPipelineTagRow,
  HfLibraryRow,
  HfScanKindRow,
  HfTagRow,
} from "@/lib/queries";

const mockHeadline: HfHeadlineRow = {
  total_models: "42000",
  total_downloads: "120000000",
  total_likes: "1800000",
  scan_kinds_covered: "10",
  last_scan_at: "2026-07-26T12:00:00Z",
};

const mockTopModels: HfTopModelRow[] = [
  { model_id: "meta-llama/Llama-3-70b", author: "meta-llama", pipeline_tag: "text-generation", library_name: "transformers", downloads: "25000000", likes: "15000", is_gated: "0", is_private: "0", created_at: "2026-07-01T00:00:00Z" },
  { model_id: "openai/clip-vit", author: "openai", pipeline_tag: "image-classification", library_name: "transformers", downloads: "18000000", likes: "9800", is_gated: "0", is_private: "0", created_at: "2026-06-15T00:00:00Z" },
  { model_id: "gated/custom-model", author: "gated-inc", pipeline_tag: "", library_name: "", downloads: "500000", likes: "200", is_gated: "1", is_private: "0", created_at: "2026-07-20T00:00:00Z" },
];

const mockTrending: HfTrendingModelRow[] = [
  { model_id: "new/hot-model", author: "new-org", pipeline_tag: "text-generation", created_at: "2026-07-26T10:00:00Z", scan_at: "2026-07-26T12:00:00Z" },
  { model_id: "old/cooling-model", author: "old-org", pipeline_tag: "", created_at: "2026-07-25T08:00:00Z", scan_at: "2026-07-26T12:00:00Z" },
];

const mockAuthors: HfAuthorRow[] = [
  { author: "meta-llama", model_count: "45", total_downloads: "120000000", total_likes: "45000" },
  { author: "openai", model_count: "28", total_downloads: "85000000", total_likes: "32000" },
];

const mockPipelineTags: HfPipelineTagRow[] = [
  { pipeline_tag: "text-generation", model_count: "1200", total_downloads: "50000000" },
  { pipeline_tag: "image-classification", model_count: "800", total_downloads: "30000000" },
];

const mockLibraries: HfLibraryRow[] = [
  { library_name: "transformers", model_count: "3000", total_downloads: "80000000" },
  { library_name: "diffusers", model_count: "1200", total_downloads: "25000000" },
];

const mockScanKinds: HfScanKindRow[] = [
  { scan_kind: "hourly", model_count: "1500", total_downloads: "45000000", total_likes: "120000", last_scan_at: "2026-07-26T12:00:00Z" },
  { scan_kind: "daily", model_count: "3000", total_downloads: "75000000", total_likes: "250000", last_scan_at: "2026-07-26T12:00:00Z" },
];

const mockTags: HfTagRow[] = [
  { tag: "llama", model_count: "500" },
  { tag: "vision", model_count: "350" },
];

describe("ModelsSurface component", () => {
  it("accepts all required props", () => {
    const element = createElement(ModelsSurface, {
      topModels: [],
      trendingModels: [],
      authorLeaderboard: [],
      pipelineTags: [],
      libraryDistribution: [],
      scanKindBreakdown: [],
      tagFrequency: [],
    });
    const p = element.props;
    expect(p.topModels).toEqual([]);
    expect(p.trendingModels).toEqual([]);
    expect(p.authorLeaderboard).toEqual([]);
    expect(p.pipelineTags).toEqual([]);
    expect(p.libraryDistribution).toEqual([]);
    expect(p.scanKindBreakdown).toEqual([]);
    expect(p.tagFrequency).toEqual([]);
  });

  it("accepts optional headline", () => {
    const element = createElement(ModelsSurface, {
      headline: mockHeadline,
      topModels: [],
      trendingModels: [],
      authorLeaderboard: [],
      pipelineTags: [],
      libraryDistribution: [],
      scanKindBreakdown: [],
      tagFrequency: [],
    });
    expect(element.props.headline).toBeDefined();
    expect(element.props.headline!.total_models).toBe("42000");
  });

  it("handles headline absent gracefully", () => {
    const element = createElement(ModelsSurface, {
      topModels: [],
      trendingModels: [],
      authorLeaderboard: [],
      pipelineTags: [],
      libraryDistribution: [],
      scanKindBreakdown: [],
      tagFrequency: [],
    });
    expect(element.props.headline).toBeUndefined();
  });

  it("accepts topModels with gated/private fields", () => {
    const element = createElement(ModelsSurface, {
      topModels: mockTopModels,
      trendingModels: [],
      authorLeaderboard: [],
      pipelineTags: [],
      libraryDistribution: [],
      scanKindBreakdown: [],
      tagFrequency: [],
    });
    expect(element.props.topModels).toHaveLength(3);
    const gated = element.props.topModels.find((r: HfTopModelRow) => r.is_gated === "1");
    expect(gated).toBeDefined();
    expect(gated?.model_id).toBe("gated/custom-model");
  });

  it("accepts trending models with pipeline tags and age", () => {
    const element = createElement(ModelsSurface, {
      topModels: [],
      trendingModels: mockTrending,
      authorLeaderboard: [],
      pipelineTags: [],
      libraryDistribution: [],
      scanKindBreakdown: [],
      tagFrequency: [],
    });
    expect(element.props.trendingModels).toHaveLength(2);
    expect(element.props.trendingModels[0].pipeline_tag).toBe("text-generation");
    expect(element.props.trendingModels[0].created_at).toBeTruthy();
  });

  it("accepts pipeline tags and library data", () => {
    const element = createElement(ModelsSurface, {
      topModels: [],
      trendingModels: [],
      authorLeaderboard: [],
      pipelineTags: mockPipelineTags,
      libraryDistribution: mockLibraries,
      scanKindBreakdown: [],
      tagFrequency: [],
    });
    expect(element.props.pipelineTags).toHaveLength(2);
    expect(element.props.libraryDistribution).toHaveLength(2);
  });

  it("accepts author leaderboard and tag frequency", () => {
    const element = createElement(ModelsSurface, {
      topModels: [],
      trendingModels: [],
      authorLeaderboard: mockAuthors,
      pipelineTags: [],
      libraryDistribution: [],
      scanKindBreakdown: [],
      tagFrequency: mockTags,
    });
    expect(element.props.authorLeaderboard).toHaveLength(2);
    expect(element.props.tagFrequency).toHaveLength(2);
  });

  it("accepts scan kind breakdown", () => {
    const element = createElement(ModelsSurface, {
      topModels: [],
      trendingModels: [],
      authorLeaderboard: [],
      pipelineTags: [],
      libraryDistribution: [],
      scanKindBreakdown: mockScanKinds,
      tagFrequency: [],
    });
    expect(element.props.scanKindBreakdown).toHaveLength(2);
    expect(element.props.scanKindBreakdown[0].scan_kind).toBe("hourly");
  });
});
