import { clickhouse } from "./clickhouse";

type TableRow = {
  database: string;
  name: string;
  engine: string;
  total_rows?: string;
  size?: string;
};

export type DataPolicyTier = "GOLD" | "SILVER" | "BRONZE" | "INTERNAL_OPS";

export function getDataPolicyTier(database: string): { tier: DataPolicyTier; priority: number; label: string; recommendation: string } {
  const db = database.toLowerCase();
  if (db === "curated") {
    return {
      tier: "GOLD",
      priority: 1,
      label: "[GOLD: Pre-aggregated / Sanitized View]",
      recommendation: "PREFERRED: Fast, sanitized, pre-aggregated data (< 50ms response). Target first.",
    };
  }
  if (db === "cleansed") {
    return {
      tier: "SILVER",
      priority: 2,
      label: "[SILVER: Cleaned & Typed Data]",
      recommendation: "SECONDARY: Structured, cleansed data. Query when curated views do not contain target metrics.",
    };
  }
  if (db === "default" || db === "raw") {
    return {
      tier: "BRONZE",
      priority: 3,
      label: "[BRONZE: Raw Event Firehose]",
      recommendation: "FALLBACK: Raw un-aggregated data. Deprioritize for standard analytics. ALWAYS use FINAL on ReplacingMergeTree tables.",
    };
  }
  return {
    tier: "INTERNAL_OPS",
    priority: 4,
    label: "[INTERNAL OPS: Telemetry / System Storage]",
    recommendation: "DEPRIORITIZED: Operational telemetry & ClickHouse internals. Access strictly for subagent/ops debugging.",
  };
}

const RELEVANT_TABLES = new Set([
  "task_execution_metrics",
  "task_health_summary",
  "hackernews",
  "github_events",
  "hn_hourly",
  "gh_repo_hourly",
  "daily_skinny_subject_hourly",
  "gh_repo_daily",
  "gh_repo_monthly",
  "gh_repo_metadata",
  "gh_repo_activity_feed",
  "gh_actor_daily",
  "gh_actor_pr_stats",
  "ingest_log",
]);

const TABLE_LIST_LIMIT = 50;

function summarizeEngine(engine: string) {
  if (engine.includes("View")) return "view";
  if (engine.includes("MergeTree")) return engine;
  return engine;
}

export function formatTableRow(table: TableRow): string {
  const rowHint = table.total_rows ? ` (~${Number(table.total_rows).toLocaleString()} rows)` : "";
  const policy = getDataPolicyTier(table.database);
  return `- \`${table.database}.${table.name}\` (${summarizeEngine(table.engine)}) ${policy.label}${rowHint}`;
}

/** Fallback catalog text when metadata queries fail. */
export function fallbackCatalog(): string {
  return `ClickHouse catalog (Data Policy Language Enforced):

Priority 1 (GOLD - curated.*): task_execution_metrics, task_health_summary
Priority 2 (SILVER - cleansed.*): github_events_cleansed
Priority 3 (BRONZE - default.*/raw.*): ${[...RELEVANT_TABLES].sort().join(", ")}

⚠️ Live catalog metadata unavailable at this time. The agent can still query known tables; call listTables and describeTable to discover the schema at query time.`;
}

export async function catalogPromptSection(): Promise<string> {
  try {
    const tables = await clickhouse.query({
      query: `
        SELECT database, name, engine, total_rows
        FROM system.tables
        WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
        ORDER BY
          CASE database
            WHEN 'curated' THEN 1
            WHEN 'cleansed' THEN 2
            WHEN 'default' THEN 3
            WHEN 'raw' THEN 4
            WHEN 'internal' THEN 5
            ELSE 6
          END,
          name
        LIMIT {limit: UInt32}
      `,
      format: "JSONEachRow",
      query_params: { limit: TABLE_LIST_LIMIT },
      clickhouse_settings: {
        readonly: "2",
        max_execution_time: 10,
      },
    }).then((result) => result.json<TableRow>());

    const lines = tables.map(formatTableRow);

    return `ClickHouse catalog (Data Policy Language Enforced):

Schema Priority:
1. Priority 1 (GOLD - curated.*): Pre-aggregated, sanitized views (<50ms). PREFERRED.
2. Priority 2 (SILVER - cleansed.*): Cleaned & typed tables/views. SECONDARY.
3. Priority 3 (BRONZE - default.*/raw.*): Raw event firehose. FALLBACK.
4. Priority 4 (INTERNAL OPS - internal.*/system.*): Operational telemetry. DEPRIORITIZED.

${lines.join("\n")}`;
  } catch {
    return fallbackCatalog();
  }
}
