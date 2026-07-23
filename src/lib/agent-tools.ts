import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { tool } from "ai";
import {
  describeTableDef,
  getDailyDigestDef,
  getRealBuildersDef,
  getRepoDrilldownDef,
  listTablesDef,
  renderAnswerDef,
  runReadOnlyQueryDef,
  runDataRetrievalDef,
  runVisualizationMappingDef,
} from "./agent-tool-schemas";
import { ensureTablesExist } from "./clickhouse";
import { dailyDigest } from "./digest";
import { realBuildersDeck } from "./real-builders";
import { RenderPayloadSchema } from "./render-payload";
import { repoDrilldown } from "./queries";
import { normalizeUnionQuery, runDataRetrievalAgent } from "./agents/data-retrieval-agent";
import { runVisualizationMappingAgent } from "./agents/visualization-mapping-agent";

let clickhouse: ClickHouseClient | undefined;
let tableListClickhouse: ClickHouseClient | undefined;

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const TABLE_LIST_TIMEOUT_MS = 5_000;

function createClickHouse(requestTimeoutMs: number): ClickHouseClient {
  return createClient({
    url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
    username: process.env.CLICKHOUSE_USER ?? process.env.DB_USER ?? "default",
    password: process.env.CLICKHOUSE_PASSWORD ?? process.env.DB_PASSWORD ?? "",
    database: process.env.CLICKHOUSE_DATABASE ?? "default",
    request_timeout: requestTimeoutMs,
  });
}

function getClickHouse(): ClickHouseClient {
  if (clickhouse) return clickhouse;

  clickhouse = createClickHouse(DEFAULT_REQUEST_TIMEOUT_MS);
  return clickhouse;
}

function getTableListClickHouse(): ClickHouseClient {
  if (tableListClickhouse) return tableListClickhouse;

  tableListClickhouse = createClickHouse(TABLE_LIST_TIMEOUT_MS);
  return tableListClickhouse;
}

const READ_ONLY_STATEMENTS = /^\s*(select|with|show|describe|desc|explain|exists)\b/i;
const MAX_OUTPUT_CHARS = 50_000;
const knownTables = new Set<string>();
const knownSchemas = new Map<string, string[]>();

export function resetCatalogState() {
  knownTables.clear();
  knownSchemas.clear();
}

function hasMultipleStatements(query: string) {
  return query.replace(/;+\s*$/, "").includes(";");
}

function normalizeTableName(table: string) {
  return table.trim().replace(/`/g, "").replace(/"/g, "");
}

function registerCatalogTables(tables: Array<{ database: string; name: string }>) {
  for (const table of tables) {
    knownTables.add(`${table.database}.${table.name}`);
    knownTables.add(table.name);
  }
}

function capOutput(rows: unknown[]) {
  let out = rows;
  while (out.length > 1 && JSON.stringify(out).length > MAX_OUTPUT_CHARS) {
    out = out.slice(0, Math.ceil(out.length / 2));
  }
  return { rows: out, truncated: out.length < rows.length };
}

function extractTableCandidates(query: string) {
  const cteNames = new Set<string>();
  for (const match of query.matchAll(/\b([A-Za-z_][\w$]*)\s+AS\s*\(/gi)) {
    cteNames.add(match[1]);
  }

  const refs = new Set<string>();
  for (const match of query.matchAll(/\b(?:from|join)\s+([`"]?)([A-Za-z_][\w$]*)\1(?:\.([`"]?)([A-Za-z_][\w$]*)\3)?/gi)) {
    const table = match[4] ? `${match[2]}.${match[4]}` : match[2];
    if (!cteNames.has(match[2])) refs.add(normalizeTableName(table));
  }

  return [...refs];
}

function requireCatalogedTables(query: string) {
  return extractTableCandidates(query).filter((table) => !knownTables.has(table));
}

function requireDescribedTables(query: string) {
  return extractTableCandidates(query).filter((table) => !knownSchemas.has(table));
}

export const FALLBACK_TABLES = [
  { database: "default", name: "github_events", engine: "MergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "gh_repo_metadata", engine: "ReplacingMergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "gh_repo_daily", engine: "SummingMergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "gh_repo_hourly", engine: "SummingMergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "gh_actor_daily", engine: "SummingMergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "gh_repo_activity_feed", engine: "MergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "gh_repo_analysis", engine: "ReplacingMergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "subagent_runs", engine: "MergeTree", total_rows: "estimated", size: "N/A" },
];

const TABLE_LIST_LIMIT = 50;

export const LIST_TABLES_SQL = `
  SELECT database, name, engine, total_rows, formatReadableSize(total_bytes) AS size
  FROM system.tables
  WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
  ORDER BY database, name
  LIMIT {limit: UInt32}
`.trim();

export const listTables = tool({
  ...listTablesDef,
  execute: async () => {
    const t0 = Date.now();
    try {
      const result = await getTableListClickHouse().query({
        query: LIST_TABLES_SQL,
        format: "JSONEachRow",
        query_params: { limit: TABLE_LIST_LIMIT },
        abort_signal: AbortSignal.timeout(TABLE_LIST_TIMEOUT_MS),
        clickhouse_settings: {
          readonly: "2",
          max_execution_time: 5,
        },
      });
      const tables = (await result.json()) as Array<{
        database: string;
        name: string;
        engine: string;
        total_rows: string;
        size: string;
      }>;
      const elapsedMs = Date.now() - t0;
      registerCatalogTables(tables);
      return {
        tables,
        provenance: {
          sql: LIST_TABLES_SQL,
          elapsedMs,
          rowsReturned: tables.length,
          tables: ["system.tables"],
        },
      };
    } catch {
      const elapsedMs = Date.now() - t0;
      registerCatalogTables(FALLBACK_TABLES);
      return {
        tables: FALLBACK_TABLES,
        isFallback: true,
        note: "ClickHouse system.tables query failed or timed out. Defaulting to safe catalog fallback.",
        provenance: {
          sql: LIST_TABLES_SQL,
          elapsedMs,
          rowsReturned: 0,
          tables: ["system.tables"],
        },
      };
    }
  },
});

export const describeTable = tool({
  ...describeTableDef,
  execute: async ({ table }) => {
    const normalized = normalizeTableName(table);
    const [database, name] = normalized.includes(".") ? normalized.split(".", 2) : [undefined, normalized];
    const catalogKey = database ? `${database}.${name}` : name;
    if (!knownTables.has(catalogKey) && !knownTables.has(name)) {
      return {
        error: `Unknown table ${normalized}. Call listTables first, then describe a table that listTables returned.`,
      };
    }
    const result = await getClickHouse().query({
      query: database
        ? "DESCRIBE TABLE {database: Identifier}.{name: Identifier}"
        : "DESCRIBE TABLE {name: Identifier}",
      query_params: { database, name },
      format: "JSONEachRow",
      clickhouse_settings: {
        readonly: "2",
        max_execution_time: 10,
      },
    });
    const columns = (await result.json()) as Array<{
      name: string;
      type: string;
      default_type?: string;
      default_expression?: string;
      comment?: string;
    }>;
    knownSchemas.set(catalogKey, columns.map((column) => `${column.name}:${column.type}`));
    knownSchemas.set(name, columns.map((column) => `${column.name}:${column.type}`));
    return { columns };
  },
});


export const runReadOnlyQuery = tool({
  ...runReadOnlyQueryDef,
  execute: async ({ query }) => {
    const normalizedQuery = normalizeUnionQuery(query);
    if (!READ_ONLY_STATEMENTS.test(normalizedQuery) || hasMultipleStatements(normalizedQuery)) {
      return {
        error: "Only one read-only SELECT-style statement is allowed.",
      };
    }

    try {
      const missingTables = requireCatalogedTables(normalizedQuery);
      if (missingTables.length > 0) {
        return {
          error: `Unknown table reference(s): ${missingTables.join(", ")}. Call listTables first, then describe the table(s) before writing SQL.`,
        };
      }
      const missingSchemas = requireDescribedTables(normalizedQuery);
      if (missingSchemas.length > 0) {
        return {
          error: `Undescribed table reference(s): ${missingSchemas.join(", ")}. Call describeTable on each table before writing SQL.`,
        };
      }
      const tables = extractTableCandidates(normalizedQuery);
      await ensureTablesExist(tables);
      const result = await getClickHouse().query({
        query: normalizedQuery,
        format: "JSONEachRow",
        clickhouse_settings: {
          readonly: "2",
          max_result_rows: "1000",
          result_overflow_mode: "break",
          max_execution_time: 30,
          union_default_mode: "ALL",
        },
      });
      const rows = await result.json();
      const capped = capOutput(rows);
      return {
        rowCount: rows.length,
        rows: capped.rows,
        ...(capped.truncated ? { note: "Result truncated. Refine the query or aggregate." } : {}),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});

export const getDailyDigest = tool({
  ...getDailyDigestDef,
  execute: async ({ noiseFloor }) => dailyDigest(noiseFloor),
});

export const getRealBuilders = tool({
  ...getRealBuildersDef,
  execute: async ({ window }) => realBuildersDeck(window),
});

export const getRepoDrilldown = tool({
  ...getRepoDrilldownDef,
  execute: async ({ repoName }) => repoDrilldown(repoName),
});

export const renderAnswer = tool({
  ...renderAnswerDef,
  execute: async ({ payload }) => {
    const parsed = RenderPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      };
    }
    return {
      ok: true,
      type: parsed.data.type,
      note: "Rendered to the user. Do not repeat the payload as prose.",
    };
  },
});

export const runDataRetrieval = tool({
  ...runDataRetrievalDef,
  execute: async ({ intent }) => runDataRetrievalAgent(intent),
});

export const runVisualizationMapping = tool({
  ...runVisualizationMappingDef,
  execute: async ({ intent, metadata }) => runVisualizationMappingAgent(intent, metadata),
});

export const attentionTools = {
  listTables,
  describeTable,
  runReadOnlyQuery,
  getDailyDigest,
  getRealBuilders,
  getRepoDrilldown,
  renderAnswer,
  runDataRetrieval,
  runVisualizationMapping,
};
