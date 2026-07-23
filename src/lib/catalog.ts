import { clickhouse } from "./clickhouse";

type TableRow = {
  database: string;
  name: string;
  engine: string;
  total_rows?: string;
  size?: string;
};

type DescribeRow = {
  name: string;
  type: string;
  default_type?: string;
  default_expression?: string;
  comment?: string;
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

function compactSchema(columns: DescribeRow[], maxChars = 500) {
  const rendered: string[] = [];
  let length = 0;

  for (const column of columns) {
    const part = `${column.name} ${column.type}${column.default_expression ? ` DEFAULT ${column.default_expression}` : ""}`;
    const next = rendered.length === 0 ? part.length : part.length + 2;
    if (length + next > maxChars) break;
    rendered.push(part);
    length += next;
  }

  if (rendered.length < columns.length) {
    rendered.push(`… (+${columns.length - rendered.length} more)`);
  }

  return rendered.join(", ");
}

function summarizeEngine(engine: string) {
  if (engine.includes("View")) return "view";
  if (engine.includes("MergeTree")) return engine;
  return engine;
}

export async function catalogPromptSection() {
  let tables: TableRow[] = [];
  try {
    tables = await clickhouse.query({
      query: `
        SELECT database, name, engine
        FROM system.tables
        WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
        ORDER BY database, name
        LIMIT 50
      `,
      format: "JSONEachRow",
      clickhouse_settings: {
        readonly: "2",
        max_execution_time: 5,
      },
    }).then((result) => result.json<TableRow>());
  } catch {
    tables = [
      { database: "default", name: "github_events", engine: "MergeTree" },
      { database: "default", name: "gh_repo_metadata", engine: "ReplacingMergeTree" },
      { database: "default", name: "gh_repo_daily", engine: "SummingMergeTree" },
      { database: "default", name: "gh_repo_hourly", engine: "SummingMergeTree" },
      { database: "default", name: "gh_actor_daily", engine: "SummingMergeTree" },
    ];
  }

  const lines = await Promise.all(
    tables.filter((table) => RELEVANT_TABLES.has(table.name)).map(async (table) => {
      const rows = await clickhouse.query({
        query: "DESCRIBE TABLE {database: Identifier}.{name: Identifier}",
        query_params: { database: table.database, name: table.name },
        format: "JSONEachRow",
        clickhouse_settings: {
          readonly: "2",
          max_execution_time: 10,
        },
      }).then((result) => result.json<DescribeRow>());

      const schema = compactSchema(rows);
      return `- \`${table.database}.${table.name}\` (${summarizeEngine(table.engine)}) — ${schema}`;
    })
  );

  return `ClickHouse catalog:

This catalog is generated live from ClickHouse at chat start and narrowed to the agent-relevant tables. If a table is missing here, call listTables and describeTable before writing SQL.

${lines.join("\n")}`;
}
