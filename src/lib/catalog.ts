import { clickhouse } from "./clickhouse";

type TableRow = {
  database: string;
  name: string;
  engine: string;
  total_rows?: string;
  size?: string;
};

const RELEVANT_TABLES = new Set([
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
  return `- \`${table.database}.${table.name}\` (${summarizeEngine(table.engine)})${rowHint}`;
}

/** Fallback catalog text when metadata queries fail. */
export function fallbackCatalog(): string {
  return `ClickHouse catalog:

⚠️ Catalog metadata unavailable at this time. The agent can still query known tables; call listTables and describeTable to discover the schema at query time.

Known tables: ${[...RELEVANT_TABLES].sort().join(", ")}.`;
}

export async function catalogPromptSection(): Promise<string> {
  try {
    const tables = await clickhouse.query({
      query: `
        SELECT database, name, engine, total_rows
        FROM system.tables
        WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
          AND name IN (${[...RELEVANT_TABLES].map((t) => `'${t}'`).join(", ")})
        ORDER BY database, name
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

    return `ClickHouse catalog:

This catalog is generated live from ClickHouse at chat start and narrowed to the agent-relevant tables. If a table is missing here, call listTables and describeTable before writing SQL.

${lines.join("\n")}`;
  } catch {
    return fallbackCatalog();
  }
}
