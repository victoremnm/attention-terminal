import { describe, expect, it, vi } from "vitest";

const { qMock } = vi.hoisted(() => ({ qMock: vi.fn() }));
vi.mock("./core", () => ({ q: qMock }));

import {
  hfModelsHeadline,
  hfTopModels,
  hfTrendingModels,
  hfAuthorLeaderboard,
  hfPipelineTagDistribution,
  hfLibraryDistribution,
  hfScanKindBreakdown,
  hfTagFrequency,
  hfModelDetail,
} from "./huggingface";

describe("huggingface query dependencies", () => {
  const queries: Array<[string, () => Promise<unknown>, string[]]> = [
    ["headline stats", hfModelsHeadline, ["curated.hf_model_global_latest"]],
    ["top models", () => hfTopModels(), ["curated.hf_model_global_latest"]],
    ["trending models", hfTrendingModels, ["curated.hf_model_global_latest", "raw.hf_model_snapshots"]],
    ["author leaderboard", () => hfAuthorLeaderboard(), ["curated.hf_author_summary"]],
    ["pipeline tag distribution", hfPipelineTagDistribution, ["curated.hf_model_global_latest"]],
    ["library distribution", hfLibraryDistribution, ["curated.hf_model_global_latest"]],
    ["scan kind breakdown", hfScanKindBreakdown, ["curated.hf_scan_kind_summary"]],
    ["tag frequency", () => hfTagFrequency(), ["curated.hf_model_global_latest"]],
  ];

  it.each(queries)("checks only the %s table", async (_name, query, expectedTables) => {
    qMock.mockResolvedValue({ rows: [], provenance: { sql: "SELECT 1", elapsedMs: 0 } });
    await query();
    expect(qMock.mock.calls.at(-1)?.[1]).toEqual(expectedTables);
  });

  describe("hfModelDetail", () => {
    function setupDetail() {
      qMock.mockReset();
      qMock.mockResolvedValueOnce({ rows: [{ model_id: "org/model", author: "org", pipeline_tag: "text-generation", library_name: "transformers", downloads: "1000", likes: "50", is_gated: "0", is_private: "0" }], provenance: { sql: "", elapsedMs: 0 } });
      qMock.mockResolvedValueOnce({ rows: [], provenance: { sql: "", elapsedMs: 0 } });
    }

    it("queries global latest for metadata when model exists", async () => {
      setupDetail();
      await hfModelDetail("org/model");
      expect(qMock.mock.calls[0][1]).toEqual(["curated.hf_model_global_latest"]);
    });

    it("queries raw for scan history when model exists", async () => {
      setupDetail();
      await hfModelDetail("org/model");
      expect(qMock.mock.calls[1][1]).toEqual(["raw.hf_model_snapshots"]);
    });

    it("skips history query when model not found", async () => {
      qMock.mockReset();
      qMock.mockResolvedValue({ rows: [], provenance: { sql: "", elapsedMs: 0 } });
      const result = await hfModelDetail("unknown");
      expect(result.data).toBeNull();
      expect(qMock).toHaveBeenCalledTimes(1);
    });
  });
});
