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

    it("sees through a View to the underlying ReplacingMergeTree (raw.* wraps default.*)", () => {
      // Mirrors the live catalog: raw.hackernews is a View (its own reported
      // engine is "View"), default.hackernews is the real ReplacingMergeTree
      // it wraps. Reading raw.hackernews without FINAL still returns
      // duplicate/stale rows -- the guard must flag it even though the View
      // itself isn't a ReplacingMergeTree.
      registerCatalogTables([
        { database: "raw", name: "hackernews", engine: "View" },
        { database: "default", name: "hackernews", engine: "ReplacingMergeTree" },
      ]);
      expect(requireFinalOnReplacingTables("SELECT * FROM raw.hackernews")).toEqual(["raw.hackernews"]);
      expect(requireFinalOnReplacingTables("SELECT * FROM raw.hackernews FINAL")).toEqual([]);
    });

    it("is not order-dependent when a View and its underlying table share a bare name", () => {
      // Same fixture as above, but the View is registered *before* the real
      // table -- registration order must not affect the result.
      registerCatalogTables([
        { database: "raw", name: "hackernews", engine: "View" },
        { database: "default", name: "hackernews", engine: "ReplacingMergeTree" },
      ]);
      expect(requireFinalOnReplacingTables("SELECT * FROM hackernews")).toEqual(["hackernews"]);
    });

    it("does not flag an outer reference to a CTE named after a ReplacingMergeTree table", () => {
      registerCatalogTables([{ database: "default", name: "gh_repo_metadata", engine: "ReplacingMergeTree" }]);
      // The CTE already reads the real table with FINAL; the outer SELECT
      // reads the CTE's result set, not the table itself.
      const query =
        "WITH gh_repo_metadata AS (SELECT * FROM default.gh_repo_metadata FINAL) SELECT * FROM gh_repo_metadata";
      expect(requireFinalOnReplacingTables(query)).toEqual([]);
    });

    it("recognizes FINAL after an alias (FROM t AS m FINAL)", () => {
      registerCatalogTables([{ database: "default", name: "gh_repo_metadata", engine: "ReplacingMergeTree" }]);
      const query = "SELECT * FROM default.gh_repo_metadata AS m FINAL LEFT JOIN other_table AS o ON m.id = o.id";
      expect(requireFinalOnReplacingTables(query)).toEqual([]);
    });

    it("flags FINAL placed before an alias (FROM t FINAL AS m)", () => {
      registerCatalogTables([{ database: "default", name: "gh_repo_metadata", engine: "ReplacingMergeTree" }]);
      // ClickHouse rejects `FROM t FINAL AS m` — FINAL must come after the alias.
      const query = "SELECT * FROM default.gh_repo_metadata FINAL AS m LEFT JOIN other_table AS o ON m.id = o.id";
      expect(requireFinalOnReplacingTables(query)).toEqual(["default.gh_repo_metadata"]);
    });

    it("handles the JOIN+FINAL bug from production (reported on gh_repo_metadata + gh_repo_daily)", () => {
      registerCatalogTables([
        { database: "default", name: "gh_repo_metadata", engine: "ReplacingMergeTree" },
        { database: "default", name: "gh_repo_daily", engine: "SummingMergeTree" },
      ]);
      // This SQL was syntactically valid per the guard but ClickHouse rejected it,
      // because FINAL came before the alias. After the fix, the guard either accepts
      // `AS m FINAL` or flags `FINAL AS m` — both are correct behaviors.
      const goodQuery = `
        SELECT m.repo_name
        FROM default.gh_repo_metadata AS m FINAL
        LEFT JOIN default.gh_repo_daily AS d ON d.repo_name = m.repo_name
      `;
      expect(requireFinalOnReplacingTables(goodQuery)).toEqual([]);
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
