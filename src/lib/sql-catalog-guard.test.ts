import { beforeEach, describe, expect, it } from "vitest";
import {
  extractTableCandidates,
  registerCatalogTables,
  requireCatalogedTables,
  requireFinalOnReplacingTables,
  resetCatalogState,
} from "./sql-catalog-guard";

describe("sql-catalog-guard", () => {
  beforeEach(() => {
    resetCatalogState();
  });

  describe("requireCatalogedTables", () => {
    it("flags table references not in the registered catalog", () => {
      registerCatalogTables([{ database: "default", name: "github_events", engine: "MergeTree" }]);
      const missing = requireCatalogedTables(
        "SELECT * FROM repos JOIN pushes ON repos.name = pushes.repo_name"
      );
      expect(missing).toEqual(expect.arrayContaining(["repos", "pushes"]));
    });

    it("does not flag tables that are registered", () => {
      registerCatalogTables([{ database: "raw", name: "github_events", engine: "MergeTree" }]);
      expect(requireCatalogedTables("SELECT * FROM raw.github_events")).toEqual([]);
    });
  });

  describe("requireFinalOnReplacingTables", () => {
    it("flags a ReplacingMergeTree table read without FINAL", () => {
      registerCatalogTables([{ database: "raw", name: "hackernews", engine: "ReplacingMergeTree" }]);
      expect(requireFinalOnReplacingTables("SELECT * FROM raw.hackernews WHERE type = 'story'")).toEqual([
        "raw.hackernews",
      ]);
    });

    it("does not flag a ReplacingMergeTree table read with FINAL", () => {
      registerCatalogTables([{ database: "raw", name: "hackernews", engine: "ReplacingMergeTree" }]);
      expect(requireFinalOnReplacingTables("SELECT * FROM raw.hackernews FINAL WHERE type = 'story'")).toEqual([]);
    });

    it("recognizes ClickHouse Cloud's Shared/Replicated ReplacingMergeTree variants", () => {
      registerCatalogTables([{ database: "default", name: "gh_repo_metadata", engine: "SharedReplacingMergeTree" }]);
      expect(requireFinalOnReplacingTables("SELECT * FROM gh_repo_metadata")).toEqual(["gh_repo_metadata"]);
    });

    it("does not flag non-ReplacingMergeTree tables", () => {
      registerCatalogTables([{ database: "default", name: "github_events", engine: "MergeTree" }]);
      expect(requireFinalOnReplacingTables("SELECT * FROM github_events")).toEqual([]);
    });

    it("does not flag tables of unknown engine (catalog not loaded)", () => {
      expect(requireFinalOnReplacingTables("SELECT * FROM some_table")).toEqual([]);
    });

    it("flags each distinct missing table only once across multiple joins", () => {
      registerCatalogTables([
        { database: "raw", name: "hackernews", engine: "ReplacingMergeTree" },
        { database: "default", name: "gh_repo_metadata", engine: "ReplacingMergeTree" },
      ]);
      const missing = requireFinalOnReplacingTables(
        "SELECT * FROM raw.hackernews JOIN gh_repo_metadata ON 1=1 JOIN raw.hackernews AS h2 ON 1=1"
      );
      expect(missing.sort()).toEqual(["gh_repo_metadata", "raw.hackernews"]);
    });
  });

  describe("extractTableCandidates", () => {
    it("ignores CTE names", () => {
      const candidates = extractTableCandidates(
        "WITH recent AS (SELECT 1) SELECT * FROM recent JOIN github_events ON 1=1"
      );
      expect(candidates).toEqual(["github_events"]);
    });
  });
});
