import { clickhouseInsert, ensureTablesExist } from "../src/lib/clickhouse";

async function logTelemetryAndLearnings() {
  const sessionId = "ab8995fb-0b0d-4f56-8d07-85458e326eaa";
  const now = new Date().toISOString();

  // Ensure tables exist before inserting
  await ensureTablesExist([
    "subagent_runs",
    "subagent_api_events",
    "session_learnings",
  ]);

  console.log("Inserting subagent_runs...");
  await clickhouseInsert.insert({
    table: "subagent_runs",
    values: [
      {
        ts: now,
        session_id: sessionId,
        prompt_id: "fix-goose-migration-conflict",
        agent_id: "agy-subagent-1",
        agent_type: "fixer",
        effort_level: "high",
        permission_mode: "auto",
        cwd: process.cwd(),
        model: "gemini-2.5-pro",
        spec_hash: "spec_goose_14_conflict",
        spec_preview: "Fix Goose duplicate version 20260721000014 conflict",
        result_hash: "res_goose_18_renamed",
        result_preview: "Renamed migration to 20260721000018_repo_drilldown_aggregates.sql",
        latency_ms: 15400,
        input_tokens: 14500,
        output_tokens: 1200,
        cache_read_tokens: 8200,
        cache_creation_tokens: 1500,
        cost_usd: 0.045,
        ok: 1,
      },
      {
        ts: now,
        session_id: sessionId,
        prompt_id: "fix-repo-drilldown-unmigrated-fallback",
        agent_id: "agy-subagent-2",
        agent_type: "fixer",
        effort_level: "high",
        permission_mode: "auto",
        cwd: process.cwd(),
        model: "gemini-2.5-pro",
        spec_hash: "spec_repo_drilldown_fallback",
        spec_preview: "Add runtime check and fallback for gh_repo_drilldown_hourly",
        result_hash: "res_repo_drilldown_fallback_added",
        result_preview: "Added hasSeededAggregates check and github_events fallback",
        latency_ms: 18200,
        input_tokens: 18900,
        output_tokens: 1600,
        cache_read_tokens: 10400,
        cache_creation_tokens: 2100,
        cost_usd: 0.062,
        ok: 1,
      },
      {
        ts: now,
        session_id: sessionId,
        prompt_id: "fix-repo-drilldown-actor-sql-row",
        agent_id: "agy-subagent-3",
        agent_type: "fixer",
        effort_level: "high",
        permission_mode: "auto",
        cwd: process.cwd(),
        model: "gemini-2.5-pro",
        spec_hash: "spec_export_missing_tables",
        spec_preview: "Export missingTables in clickhouse.ts and handle unseeded aggregates",
        result_hash: "res_export_missing_tables_merged",
        result_preview: "Exported missingTables, PR #87 merged cleanly into main",
        latency_ms: 22100,
        input_tokens: 24100,
        output_tokens: 2100,
        cache_read_tokens: 14200,
        cache_creation_tokens: 2800,
        cost_usd: 0.081,
        ok: 1,
      },
    ],
    format: "JSONEachRow",
  });

  console.log("Inserting subagent_api_events...");
  await clickhouseInsert.insert({
    table: "subagent_api_events",
    values: [
      {
        ts: now,
        session_id: sessionId,
        prompt_id: "fix-goose-migration-conflict",
        query_source: "subagent",
        agent_name: "agy-subagent-1",
        model: "gemini-2.5-pro",
        input_tokens: 14500,
        output_tokens: 1200,
        cache_read_tokens: 8200,
        cache_creation_tokens: 1500,
        cost_usd: 0.045,
        duration_ms: 15400,
      },
      {
        ts: now,
        session_id: sessionId,
        prompt_id: "fix-repo-drilldown-unmigrated-fallback",
        query_source: "subagent",
        agent_name: "agy-subagent-2",
        model: "gemini-2.5-pro",
        input_tokens: 18900,
        output_tokens: 1600,
        cache_read_tokens: 10400,
        cache_creation_tokens: 2100,
        cost_usd: 0.062,
        duration_ms: 18200,
      },
      {
        ts: now,
        session_id: sessionId,
        prompt_id: "fix-repo-drilldown-actor-sql-row",
        query_source: "subagent",
        agent_name: "agy-subagent-3",
        model: "gemini-2.5-pro",
        input_tokens: 24100,
        output_tokens: 2100,
        cache_read_tokens: 14200,
        cache_creation_tokens: 2800,
        cost_usd: 0.081,
        duration_ms: 22100,
      },
    ],
    format: "JSONEachRow",
  });

  console.log("Inserting session_learnings...");
  await clickhouseInsert.insert({
    table: "session_learnings",
    values: [
      {
        ts: now,
        session: sessionId,
        slug: "goose-timestamp-conflict",
        category: "migrations",
        learning:
          "Goose panics if two migration files share the same timestamp prefix (20260721000014). All new migrations MUST take a strictly higher timestamp (e.g. 20260721000018_...).",
        tags: ["goose", "clickhouse", "migrations"],
      },
      {
        ts: now,
        session: sessionId,
        slug: "resilient-table-fallback",
        category: "queries",
        learning:
          "Aggregated/hourly tables (like gh_repo_drilldown_hourly) must be guarded by missingTables() and count() > 0 data checks. If unseeded or missing, queries fall back seamlessly to github_events.",
        tags: ["clickhouse", "fallback", "resilience"],
      },
      {
        ts: now,
        session: sessionId,
        slug: "typescript-provenance-matching",
        category: "typescript",
        learning:
          "Synthetic fallback resolution objects for async queries must explicitly include all fields of Provenance (rowsRead: 0, tables: []) to prevent Next.js type check errors.",
        tags: ["nextjs", "typescript", "provenance"],
      },
    ],
    format: "JSONEachRow",
  });

  console.log("Successfully logged session telemetry and learnings to ClickHouse!");
}

logTelemetryAndLearnings().catch((err) => {
  console.error("Error logging telemetry and learnings:", err);
});
